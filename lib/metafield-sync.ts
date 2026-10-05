import { getPool } from "./db";
import { getSettings } from "./settings";
import { shopifyGraphQL } from "./shopify";

/**
 * Push loyalty balances to Shopify customer metafields so the storefront
 * theme can show "You have N points" without an app proxy round-trip.
 *
 * Only members linked to a Shopify customer whose ledger balance differs
 * from the last pushed value are sent. metafieldsSet accepts 25 entries per
 * call; a failing chunk is recorded (last_error) so it isn't retried until
 * the balance changes again.
 */
const CHUNK = 25;

export async function syncBalanceMetafields(limit = 500): Promise<{
  pending: number;
  pushed: number;
  failed: number;
}> {
  const s = await getSettings();
  const pool = getPool();
  const r = await pool.query<{ id: number; gid: string; balance: number }>(
    `SELECT c.id, c.shopify_customer_gid AS gid, COALESCE(b.balance, 0)::int AS balance
       FROM pos_customers c
       LEFT JOIN loyalty_balance b        ON b.customer_id = c.id
       LEFT JOIN loyalty_metafield_sync m ON m.customer_id = c.id
      WHERE c.shopify_customer_gid IS NOT NULL
        AND (m.customer_id IS NULL
          OR m.pushed_balance <> COALESCE(b.balance, 0)
          OR m.shopify_gid <> c.shopify_customer_gid)
      ORDER BY c.id
      LIMIT $1`,
    [limit],
  );

  let pushed = 0;
  let failed = 0;
  for (let i = 0; i < r.rows.length; i += CHUNK) {
    const chunk = r.rows.slice(i, i + CHUNK);
    let error: string | null = null;
    try {
      const data = await shopifyGraphQL<{
        metafieldsSet: { userErrors: { field: string[] | null; message: string }[] };
      }>(
        `mutation Set($m: [MetafieldsSetInput!]!) {
           metafieldsSet(metafields: $m) { userErrors { field message } }
         }`,
        {
          m: chunk.map((row) => ({
            ownerId: row.gid,
            namespace: s.metafield_namespace,
            key: s.metafield_key,
            type: "number_integer",
            value: String(Math.max(0, row.balance)),
          })),
        },
      );
      const errs = data.metafieldsSet.userErrors;
      if (errs.length) error = errs.map((e) => e.message).join(" · ").slice(0, 500);
    } catch (err) {
      error = String(err instanceof Error ? err.message : err).slice(0, 500);
    }
    // metafieldsSet is all-or-nothing, so the whole chunk shares one outcome.
    if (error) failed += chunk.length;
    else pushed += chunk.length;
    await pool.query(
      `INSERT INTO loyalty_metafield_sync (customer_id, shopify_gid, pushed_balance, pushed_at, last_error)
       SELECT * FROM unnest($1::int[], $2::text[], $3::int[]) AS t(customer_id, shopify_gid, pushed_balance),
              LATERAL (SELECT now(), $4::text) x
       ON CONFLICT (customer_id) DO UPDATE
         SET shopify_gid = EXCLUDED.shopify_gid,
             pushed_balance = EXCLUDED.pushed_balance,
             pushed_at = EXCLUDED.pushed_at,
             last_error = EXCLUDED.last_error`,
      [chunk.map((c) => c.id), chunk.map((c) => c.gid), chunk.map((c) => c.balance), error],
    );
  }
  return { pending: r.rows.length, pushed, failed };
}
