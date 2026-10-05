import { PoolClient } from "pg";

/**
 * Resolve a Shopify customer to a pos_customers row, linking or creating
 * as needed. Shared by the customers/create and orders/create webhooks so
 * an online shopper always lands on exactly one loyalty member.
 *
 * Match order:
 *   1. shopify_customer_gid already linked
 *   2. email (case-insensitive), only when exactly one unlinked row has it
 *   3. phone (last 10 digits of phone / phone_2), same uniqueness rule
 * No match → insert a new member with created_via='shopify'.
 *
 * On link, ledger rows that arrived before the link (orders/create writes
 * them keyed only on the GID) are attributed to the member.
 *
 * Only ever called from Shopify webhooks, so it marks the transaction as
 * Shopify-originated: the pos_customers trigger then doesn't queue these
 * writes to be pushed back to Shopify (migration 009).
 */
export type ShopifyCustomerPayload = {
  admin_graphql_api_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  default_address?: {
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    city?: string | null;
    province?: string | null;
    province_code?: string | null;
  } | null;
};

export async function resolveShopifyCustomer(
  client: PoolClient,
  gid: string,
  c: ShopifyCustomerPayload,
): Promise<{ customerId: number; created: boolean; wasLinked: boolean }> {
  await client.query(`SELECT set_config('carbon.sync_origin', 'shopify', true)`);
  const linked = await client.query<{ id: number }>(
    `SELECT id FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [gid],
  );
  if (linked.rows[0]) return { customerId: linked.rows[0].id, created: false, wasLinked: true };

  const email = c.email?.trim().toLowerCase() || null;
  const phone = last10(customerPhone(c));

  let matchId: number | null = null;
  if (email) {
    const r = await client.query<{ id: number }>(
      `SELECT id FROM pos_customers
        WHERE lower(trim(email)) = $1 AND shopify_customer_gid IS NULL
        LIMIT 2`,
      [email],
    );
    if (r.rows.length === 1) matchId = r.rows[0].id;
  }
  if (matchId == null && phone) {
    const r = await client.query<{ id: number }>(
      `SELECT id FROM pos_customers
        WHERE shopify_customer_gid IS NULL
          AND (right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $1
            OR right(regexp_replace(coalesce(phone_2, ''), '\\D', '', 'g'), 10) = $1)
        LIMIT 2`,
      [phone],
    );
    if (r.rows.length === 1) matchId = r.rows[0].id;
  }

  let customerId: number;
  let created = false;
  if (matchId != null) {
    customerId = matchId;
    await client.query(
      `UPDATE pos_customers
          SET shopify_customer_gid = $1,
              shopify_linked_at    = COALESCE(shopify_linked_at, now())
        WHERE id = $2`,
      [gid, customerId],
    );
  } else {
    // Build "City, ST" from the Shopify default address so the member
    // shows up in WMS with real geo provenance instead of "—".
    const ins = await client.query<{ id: number }>(
      `INSERT INTO pos_customers
         (first_name, last_name, email, phone, birthday,
          shopify_customer_gid, shopify_linked_at,
          created_via, created_at_geo, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5, now(), 'shopify', $6, now())
       RETURNING id`,
      [firstName(c), c.last_name || c.default_address?.last_name || null, c.email ?? null, posPhone(customerPhone(c)), gid, formatGeo(c.default_address)],
    );
    customerId = ins.rows[0].id;
    created = true;
  }

  await client.query(
    `UPDATE loyalty_ledger SET customer_id = $1
      WHERE shopify_gid = $2 AND customer_id IS NULL`,
    [customerId, gid],
  );
  return { customerId, created, wasLinked: false };
}

/**
 * pos_customers.first_name is required, but Shopify customers can be
 * nameless (email-only checkout). Fall back to the address name, then the
 * email's local part, so the member — and their points — still get created.
 */
function firstName(c: ShopifyCustomerPayload): string {
  return (
    c.first_name?.trim() ||
    c.default_address?.first_name?.trim() ||
    c.email?.split("@")[0]?.trim() ||
    "Customer"
  );
}

/**
 * The customer's phone as Shopify shows it to them: the customer-level phone,
 * or — when that's empty, which is common — the default address phone.
 */
export function customerPhone(c: ShopifyCustomerPayload): string | null {
  return c.phone?.trim() || c.default_address?.phone?.trim() || null;
}

/** POS stores US numbers as bare 10 digits ("3165186720"); keep that shape. */
export function posPhone(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : p!.trim();
}

function last10(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

/**
 * "City, ST" or "City" or "ST" — never an empty trailing comma. Returns
 * null if neither field is present so the column stays NULL instead of
 * ", " junk.
 */
function formatGeo(addr: ShopifyCustomerPayload["default_address"]): string | null {
  if (!addr) return null;
  const city = (addr.city ?? "").trim();
  const state = (addr.province_code ?? addr.province ?? "").trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}
