import { PoolClient } from "pg";
import { getPool, withTransaction } from "./db";
import { getSettings } from "./settings";

/**
 * Domain logic for the loyalty service.
 *
 * Append-only ledger model. Balance is always SUM(delta_points) — we never
 * UPDATE existing rows. Idempotency is enforced by the unique
 * (source, source_ref) index on loyalty_ledger plus the
 * loyalty_idempotency table for short-lived API request dedupe.
 */

export type LedgerReason =
  | "sale"
  | "redemption"
  | "refund"
  | "signup_bonus"
  | "birthday_bonus"
  | "referral_bonus"
  | "manual"
  | "adjustment"
  | "migration";

export type LedgerSource = "pos" | "shopify" | "admin" | "system";

export async function getBalance(customerId: number): Promise<number> {
  const r = await getPool().query<{ balance: string }>(
    `SELECT COALESCE(SUM(delta_points), 0)::text AS balance
       FROM loyalty_ledger WHERE customer_id = $1`,
    [customerId],
  );
  return Number(r.rows[0]?.balance ?? 0);
}

/**
 * floor(eligible × earn_rate). Tax / gift-card-purchase exclusion is the
 * caller's responsibility — they pass a pre-cleaned `eligible_amount` so
 * we don't reach into pos_sales schemas.
 */
export async function pointsForEligible(eligible: number): Promise<number> {
  const s = await getSettings();
  if (eligible <= 0) return 0;
  return Math.floor(eligible * s.earn_rate_per_dollar);
}

/**
 * dollarsOff(points) = points / redeem_points_per_dollar (default 10 → $10/100pts).
 */
export async function dollarsForPoints(points: number): Promise<number> {
  const s = await getSettings();
  return Math.round((points / s.redeem_points_per_dollar) * 100) / 100;
}

/**
 * Insert one ledger row inside an open transaction.
 * Returns the new row's id + the new running balance.
 */
export async function insertLedger(
  client: PoolClient,
  row: {
    customer_id: number | null;
    shopify_gid: string | null;
    delta_points: number;
    reason: LedgerReason;
    source: LedgerSource;
    source_ref: string | null;
    amount_basis: number | null;
    created_by?: string | null;
  },
): Promise<{ id: number; new_balance: number }> {
  const ins = await client.query<{ id: string }>(
    `INSERT INTO loyalty_ledger
       (customer_id, shopify_gid, delta_points, reason, source, source_ref, amount_basis, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      row.customer_id,
      row.shopify_gid,
      row.delta_points,
      row.reason,
      row.source,
      row.source_ref,
      row.amount_basis,
      row.created_by ?? null,
    ],
  );
  // If the unique (source, source_ref) hit, ON CONFLICT DO NOTHING returns
  // zero rows. Look up the existing row and return its id.
  let id: number;
  if (ins.rowCount === 0 && row.source_ref) {
    const ex = await client.query<{ id: string }>(
      `SELECT id FROM loyalty_ledger WHERE source = $1 AND source_ref = $2`,
      [row.source, row.source_ref],
    );
    if (!ex.rows[0]) throw new Error("ledger_insert_lost");
    id = Number(ex.rows[0].id);
  } else {
    id = Number(ins.rows[0].id);
  }
  // Balance for the customer (or for a Shopify-only event keyed on GID).
  let balance = 0;
  if (row.customer_id != null) {
    const b = await client.query<{ b: string }>(
      `SELECT COALESCE(SUM(delta_points), 0)::text AS b
         FROM loyalty_ledger WHERE customer_id = $1`,
      [row.customer_id],
    );
    balance = Number(b.rows[0]?.b ?? 0);
  }
  return { id, new_balance: balance };
}

/**
 * Idempotency dedupe.
 *
 * If we've seen `key` before, return the cached response. Otherwise return
 * null and let the caller proceed; they'll persist the response via
 * `recordIdempotency` once they're done.
 */
export async function lookupIdempotency(
  key: string,
): Promise<{ status: number; body: unknown } | null> {
  const r = await getPool().query<{
    response_status: number;
    response_body: unknown;
  }>(
    `SELECT response_status, response_body FROM loyalty_idempotency WHERE key = $1`,
    [key],
  );
  if (!r.rows[0]) return null;
  return { status: r.rows[0].response_status, body: r.rows[0].response_body };
}

export async function recordIdempotency(
  client: PoolClient,
  key: string,
  endpoint: string,
  requestHash: string,
  status: number,
  body: unknown,
  ledgerId: number | null,
): Promise<void> {
  await client.query(
    `INSERT INTO loyalty_idempotency
       (key, endpoint, request_hash, response_status, response_body, ledger_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (key) DO NOTHING`,
    [key, endpoint, requestHash, status, JSON.stringify(body), ledgerId],
  );
}

export { withTransaction };
