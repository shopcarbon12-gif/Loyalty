import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { queueEmail } from "./email";
import { insertLedger } from "./loyalty";
import { getSettings } from "./settings";

/**
 * Referrals. A member shares https://shopcarbon.com/?ref=<code>; the theme
 * (snippet carbon-referral-capture) stores the code as the cart attribute
 * `carbon_ref`, so it arrives on the order. On the referee's FIRST purchase
 * of at least referral_min_purchase, both sides are paid
 * (referral_reward_points to the referrer, referee_earns_points to the
 * new customer). POS sales use the same rules through /api/v1/earn.
 */
export function shareUrl(code: string): string {
  return `https://shopcarbon.com/?ref=${encodeURIComponent(code)}`;
}

/** The member's referral code, minted on first request (CARBON-<NAME>-<6 hex>). */
export async function referralCode(customerId: number): Promise<string | null> {
  const pool = getPool();
  const existing = await pool.query<{ code: string }>(
    `SELECT code FROM loyalty_referrals WHERE referrer_customer_id = $1`,
    [customerId],
  );
  if (existing.rows[0]) return existing.rows[0].code;
  const c = await pool.query<{ first_name: string | null }>(`SELECT first_name FROM pos_customers WHERE id = $1`, [customerId]);
  if (!c.rows[0]) return null;
  const slug = (c.rows[0].first_name || "carbon").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) || "CARBON";
  const code = `CARBON-${slug}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const ins = await pool.query<{ code: string }>(
    `INSERT INTO loyalty_referrals (code, referrer_customer_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING code`,
    [code, customerId],
  );
  return ins.rows[0]?.code ?? (await referralCode(customerId));
}

/**
 * Called inside the orders/create transaction after the earn row. Records
 * the attribution from the order's `carbon_ref` (new customers only) and
 * pays both sides when this is a qualifying first purchase.
 */
export async function referralForOnlineOrder(
  client: PoolClient,
  o: { refereeId: number; refereeGid: string; orderGid: string; eligible: number; refCode: string | null },
): Promise<{ paid: boolean }> {
  const s = await getSettings();
  // Only a customer's first purchase can be referred or pay out.
  const prior = await client.query(
    `SELECT 1 FROM customer_purchases WHERE customer_id = $1 AND ref <> $2 AND status <> 'cancelled' LIMIT 1`,
    [o.refereeId, o.orderGid],
  );
  if (prior.rows[0]) return { paid: false };

  if (o.refCode) {
    const ref = await client.query<{ id: string; referrer_customer_id: number }>(
      `SELECT r.id::text, r.referrer_customer_id FROM loyalty_referrals r
        JOIN pos_customers referrer ON referrer.id = r.referrer_customer_id
        JOIN pos_customers referee  ON referee.id = $2
       WHERE upper(r.code) = upper($1)
         AND r.referrer_customer_id <> $2
         -- same person under a second account doesn't count
         AND (referee.email IS NULL OR referrer.email IS NULL OR lower(referee.email) <> lower(referrer.email))`,
      [o.refCode.trim(), o.refereeId],
    );
    if (ref.rows[0]) {
      await client.query(
        `INSERT INTO loyalty_referral_redemptions (referral_id, referee_customer_id)
         VALUES ($1, $2)
         ON CONFLICT (referee_customer_id) WHERE referee_customer_id IS NOT NULL DO NOTHING`,
        [Number(ref.rows[0].id), o.refereeId],
      );
    }
  }

  if (o.eligible < Number(s.referral_min_purchase)) return { paid: false };
  const pending = await client.query<{ id: string; referrer_customer_id: number }>(
    `SELECT lrr.id::text, lr.referrer_customer_id
       FROM loyalty_referral_redemptions lrr
       JOIN loyalty_referrals lr ON lr.id = lrr.referral_id
      WHERE lrr.referee_customer_id = $1 AND lrr.referrer_ledger_id IS NULL
      LIMIT 1
      FOR UPDATE OF lrr SKIP LOCKED`,
    [o.refereeId],
  );
  const p = pending.rows[0];
  if (!p || p.referrer_customer_id === o.refereeId) return { paid: false };

  const referrerLed = await insertLedger(client, {
    customer_id: p.referrer_customer_id,
    shopify_gid: null,
    delta_points: s.referral_reward_points,
    reason: "referral_bonus",
    source: "system",
    source_ref: `referral:referrer:order:${o.orderGid}`,
    amount_basis: null,
  });
  const refereeLed = await insertLedger(client, {
    customer_id: o.refereeId,
    shopify_gid: o.refereeGid,
    delta_points: s.referee_earns_points,
    reason: "referral_bonus",
    source: "system",
    source_ref: `referral:referee:order:${o.orderGid}`,
    amount_basis: null,
  });
  await client.query(
    `UPDATE loyalty_referral_redemptions
        SET qualifying_amount = $2, referrer_ledger_id = $3, referee_ledger_id = $4, shopify_order_gid = $5
      WHERE id = $1`,
    [Number(p.id), o.eligible, referrerLed.id, refereeLed.id, o.orderGid],
  );
  await queueEmail(client, {
    customerId: p.referrer_customer_id,
    template: "referral_reward",
    data: { points: s.referral_reward_points },
    ledgerId: referrerLed.id,
    dedupeKey: `referral-reward:${o.orderGid}`,
  });
  await queueEmail(client, {
    customerId: o.refereeId,
    template: "referral_welcome",
    data: { points: s.referee_earns_points },
    ledgerId: refereeLed.id,
    dedupeKey: `referral-welcome:${o.orderGid}`,
  });
  return { paid: true };
}
