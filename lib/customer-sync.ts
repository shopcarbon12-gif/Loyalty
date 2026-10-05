import { getPool } from "./db";
import { findShopifyCustomer, shopifyGraphQL } from "./shopify";

/**
 * Push member changes made in POS / WMS to Shopify (migration 009 queues
 * them in customer_sync_outbox via a pos_customers trigger).
 *
 * Linked member  → customerUpdate.
 * Not linked yet → link to the Shopify customer with the same email/phone,
 *                  or customerCreate, then store the link.
 *
 * Shopify requires unique email/phone across customers; when it rejects
 * one we retry without it so the rest of the change still lands. Writes
 * here don't re-queue: shopify_customer_gid isn't a trigger column, and
 * the resulting customers/update webhook is tagged Shopify-originated.
 */
const MAX_ATTEMPTS = 5;

type Member = {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  shopify_customer_gid: string | null;
};

type UserError = { field: string[] | null; message: string };

export async function syncCustomersToShopify(limit = 40): Promise<{ processed: number; pushed: number; failed: number }> {
  const pool = getPool();
  const q = await pool.query<Member>(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.shopify_customer_gid
       FROM customer_sync_outbox o JOIN pos_customers c ON c.id = o.customer_id
      WHERE o.attempts < $1
      ORDER BY o.queued_at
      LIMIT $2`,
    [MAX_ATTEMPTS, limit],
  );
  let pushed = 0;
  let failed = 0;
  for (const m of q.rows) {
    try {
      await pushMember(m);
      await pool.query(`DELETE FROM customer_sync_outbox WHERE customer_id = $1`, [m.id]);
      pushed++;
    } catch (err) {
      failed++;
      await pool.query(
        `UPDATE customer_sync_outbox SET attempts = attempts + 1, last_error = $2 WHERE customer_id = $1`,
        [m.id, String(err instanceof Error ? err.message : err).slice(0, 500)],
      );
    }
  }
  return { processed: q.rows.length, pushed, failed };
}

async function pushMember(m: Member): Promise<void> {
  const email = m.email?.trim() || null;
  const phone = e164(m.phone);
  let gid = m.shopify_customer_gid;

  if (!gid) {
    const found = await findShopifyCustomer({ email, phone });
    if (found) {
      const taken = await getPool().query(
        `SELECT 1 FROM pos_customers WHERE shopify_customer_gid = $1 AND id <> $2 LIMIT 1`,
        [found.gid, m.id],
      );
      if (!taken.rows[0]) gid = found.gid;
    }
  }

  type Input = { firstName?: string; lastName?: string; email?: string; phone?: string };
  const base: Input = { firstName: m.first_name ?? undefined, lastName: m.last_name ?? undefined };
  const attempts: Input[] = [
    { ...base, email: email ?? undefined, phone: phone ?? undefined },
    { ...base, email: email ?? undefined },
    { ...base, phone: phone ?? undefined },
    base,
  ];

  if (gid) {
    await tryEach(attempts, async (input) => {
      const d = await shopifyGraphQL<{ customerUpdate: { customer: { id: string } | null; userErrors: UserError[] } }>(
        `mutation U($input: CustomerInput!) { customerUpdate(input: $input) { customer { id } userErrors { field message } } }`,
        { input: { id: gid, ...input } },
      );
      return d.customerUpdate.userErrors;
    });
  } else {
    if (!email && !phone) return; // nothing Shopify can key a customer on
    let created: string | null = null;
    await tryEach(attempts.filter((a) => a.email || a.phone), async (input) => {
      const d = await shopifyGraphQL<{ customerCreate: { customer: { id: string } | null; userErrors: UserError[] } }>(
        `mutation C($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }`,
        { input },
      );
      created = d.customerCreate.customer?.id ?? null;
      return d.customerCreate.userErrors;
    });
    gid = created;
  }

  if (gid && gid !== m.shopify_customer_gid) {
    await getPool().query(
      `UPDATE pos_customers SET shopify_customer_gid = $1, shopify_linked_at = COALESCE(shopify_linked_at, now())
        WHERE id = $2`,
      [gid, m.id],
    );
  }
}

/** Run each input until Shopify accepts one; email/phone clashes fall through to the next. */
async function tryEach<T>(inputs: T[], run: (input: T) => Promise<UserError[]>): Promise<void> {
  let last: UserError[] = [];
  for (const input of inputs) {
    last = await run(input);
    if (!last.length) return;
    const contactClash = last.every((e) => /phone|email/i.test((e.field ?? []).join(".") + " " + e.message));
    if (!contactClash) break;
  }
  throw new Error(last.map((e) => e.message).join(" · ") || "shopify_rejected");
}

/** POS keeps US numbers as 10 digits; Shopify wants E.164. */
function e164(p: string | null): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
