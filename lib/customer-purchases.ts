import { getPool } from "./db";

/**
 * A member's purchases for the Member Club pages — the customer-account
 * extension (/api/account/purchases) and the storefront Member Club page
 * (app proxy /apps/loyalty/purchases).
 *
 *  - storePurchases: Carbon POS sales with their lines and the points each
 *    earned (POS earn rows are keyed source_ref = 'pos:sale:<sale id>').
 *  - onlinePoints: points each online order earned, by Shopify order number id
 *    (orders/create writes source_ref = the order GID).
 */
export type StorePurchase = {
  number: string;
  points: number | null;
  placed_at: string;
  total: number;
  status: string;
  store: string | null;
  lines: { description: string; quantity: number; total: number; type: string }[];
};

export async function storePurchases(customerId: number, limit = 50): Promise<StorePurchase[]> {
  const pool = getPool();
  const sales = await pool.query<{
    ref: string; number: string; placed_at: string; total: string; status: string; location_name: string | null;
  }>(
    `SELECT ref, number, placed_at, total::text, status, location_name
       FROM customer_purchases
      WHERE customer_id = $1 AND channel = 'store'
      ORDER BY placed_at DESC
      LIMIT $2`,
    [customerId, limit],
  );
  const ids = sales.rows.map((s) => Number(s.ref));
  if (!ids.length) return [];
  const [lines, earned] = await Promise.all([
    pool.query<{ sale_id: number; description: string; quantity: number; line_total: string; line_type: string }>(
      `SELECT sale_id, description, quantity, line_total::text, line_type
         FROM pos_sale_lines WHERE sale_id = ANY($1::int[]) ORDER BY id`,
      [ids],
    ),
    pool.query<{ source_ref: string; points: string }>(
      `SELECT source_ref, sum(delta_points)::text AS points
         FROM loyalty_ledger
        WHERE customer_id = $1 AND source = 'pos' AND reason = 'sale' AND source_ref = ANY($2::text[])
        GROUP BY source_ref`,
      [customerId, ids.map((id) => `pos:sale:${id}`)],
    ),
  ]);
  const pointsBySale = new Map(earned.rows.map((r) => [r.source_ref, Number(r.points)]));
  return sales.rows.map((s) => ({
    number: s.number,
    points: pointsBySale.get(`pos:sale:${s.ref}`) ?? null,
    placed_at: s.placed_at,
    total: Number(s.total),
    status: s.status,
    store: s.location_name,
    lines: lines.rows
      .filter((l) => l.sale_id === Number(s.ref))
      .map((l) => ({ description: l.description, quantity: l.quantity, total: Number(l.line_total), type: l.line_type })),
  }));
}

/**
 * { "<order number id>": points } for the member's online orders — what each
 * order still counts for: the earn row minus any cancel/refund reversals
 * (shopify:cancel:<gid>, shopify:refund:<gid>:<refund>; see
 * reverseOnlineOrderPoints in lib/orders.ts). A cancelled order nets to 0.
 */
export async function onlinePoints(customerId: number): Promise<Record<string, number>> {
  const r = await getPool().query<{ order_id: string; points: string }>(
    `SELECT substring(source_ref FROM 'gid://shopify/Order/([0-9]+)') AS order_id,
            sum(delta_points)::text AS points
       FROM loyalty_ledger
      WHERE customer_id = $1 AND source = 'shopify'
        AND (   (reason = 'sale'   AND source_ref LIKE 'gid://shopify/Order/%')
             OR (reason = 'refund' AND (source_ref LIKE 'shopify:cancel:gid://shopify/Order/%'
                                     OR source_ref LIKE 'shopify:refund:gid://shopify/Order/%')))
      GROUP BY 1`,
    [customerId],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) if (row.order_id) out[row.order_id] = Math.max(0, Number(row.points));
  return out;
}
