import { randomBytes } from "crypto";
import type { PoolClient } from "pg";
import { getPool, withTransaction } from "./db";
import { dollarsForPoints, insertLedger } from "./loyalty";
import { getSettings } from "./settings";
import { shopifyGraphQL } from "./shopify";

/**
 * Online redemption: trade points for a single-use Shopify discount code
 * locked to the member's Shopify customer.
 *
 * Rules come from loyalty_settings, same as POS:
 *   - points ≥ min_redeem_points and a multiple of redeem_increment_points
 *   - value = points / redeem_points_per_dollar
 *   - max_redeem_dollars_per_order caps a single code ($30); codes don't
 *     combine with each other, so that's also the cap per purchase
 *   - max_redeem_pct_of_order → minimum subtotal on the code
 *   - allow_stacking_with_codes → combinesWith
 *   - coupon_ttl_hours → endsAt; unused codes are credited back on expiry
 */
export class RedeemError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}

export type IssuedCoupon = {
  code: string;
  points: number;
  dollars: number;
  min_subtotal: number | null;
  expires_at: string;
  new_balance: number;
};

export async function issueCoupon(
  customerId: number,
  customerGid: string,
  points: number,
): Promise<IssuedCoupon> {
  const s = await getSettings();
  if (!s.live) throw new RedeemError("live_off", "Rewards redemption is paused.", 503);
  if (!Number.isInteger(points) || points < s.min_redeem_points) {
    throw new RedeemError("below_minimum", `Minimum redemption is ${s.min_redeem_points} points.`);
  }
  if (points % s.redeem_increment_points !== 0) {
    throw new RedeemError("increment_invalid", `Points must be a multiple of ${s.redeem_increment_points}.`);
  }
  const dollars = await dollarsForPoints(points);
  if (s.max_redeem_dollars_per_order > 0 && dollars > s.max_redeem_dollars_per_order) {
    throw new RedeemError(
      "above_maximum",
      `You can take up to $${s.max_redeem_dollars_per_order} off per purchase.`,
    );
  }
  const minSubtotal =
    s.max_redeem_pct_of_order > 0 && s.max_redeem_pct_of_order < 100
      ? Math.ceil((dollars * 100) / s.max_redeem_pct_of_order)
      : null;
  const expiresAt = new Date(Date.now() + s.coupon_ttl_hours * 3600_000);
  const code = `CR-${randomBytes(4).toString("hex").toUpperCase()}`;

  return withTransaction(async (client) => {
    // Serialize redemptions per member so two taps can't double-spend.
    await client.query(`SELECT id FROM pos_customers WHERE id = $1 FOR UPDATE`, [customerId]);
    const balance = await balanceOf(client, customerId);
    if (balance < points) throw new RedeemError("insufficient_balance", "Not enough points.", 402);

    const led = await insertLedger(client, {
      customer_id: customerId,
      shopify_gid: customerGid,
      delta_points: -points,
      reason: "redemption",
      source: "shopify",
      source_ref: `coupon:${code}`,
      amount_basis: dollars,
    });

    // Created inside the transaction: if Shopify rejects it, the debit
    // rolls back with it.
    const data = await shopifyGraphQL<{
      discountCodeBasicCreate: {
        codeDiscountNode: { id: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(
      `mutation Create($d: DiscountCodeBasicInput!) {
         discountCodeBasicCreate(basicCodeDiscount: $d) {
           codeDiscountNode { id }
           userErrors { field message }
         }
       }`,
      {
        d: {
          title: `Carbon Rewards ${points} pts → $${dollars} (member #${customerId})`,
          code,
          startsAt: new Date().toISOString(),
          endsAt: expiresAt.toISOString(),
          usageLimit: 1,
          appliesOncePerCustomer: true,
          customerSelection: { customers: { add: [customerGid] } },
          customerGets: {
            value: { discountAmount: { amount: dollars, appliesOnEachItem: false } },
            items: { all: true },
          },
          minimumRequirement: minSubtotal
            ? { subtotal: { greaterThanOrEqualToSubtotal: minSubtotal } }
            : null,
          combinesWith: {
            orderDiscounts: s.allow_stacking_with_codes,
            productDiscounts: s.allow_stacking_with_codes,
            shippingDiscounts: true,
          },
        },
      },
    );
    const res = data.discountCodeBasicCreate;
    if (!res.codeDiscountNode) {
      console.error("[issueCoupon]", res.userErrors);
      throw new RedeemError("shopify_error", "Couldn't create your code — please try again.", 502);
    }

    await client.query(
      `INSERT INTO loyalty_coupons
         (customer_id, shopify_gid, code, discount_gid, points, dollars, min_subtotal, ledger_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [customerId, customerGid, code, res.codeDiscountNode.id, points, dollars, minSubtotal, led.id, expiresAt],
    );
    return {
      code,
      points,
      dollars,
      min_subtotal: minSubtotal,
      expires_at: expiresAt.toISOString(),
      new_balance: led.new_balance,
    };
  });
}

/** Called from orders/create — marks any of our codes used on the order. */
export async function markCouponsUsed(codes: string[], orderGid: string): Promise<void> {
  const ours = codes.map((c) => c.trim().toUpperCase()).filter((c) => c.startsWith("CR-"));
  if (!ours.length) return;
  await getPool().query(
    `UPDATE loyalty_coupons SET used_at = now(), used_order_gid = $2
      WHERE code = ANY($1::text[]) AND used_at IS NULL`,
    [ours, orderGid],
  );
}

/**
 * Credit back points for codes that expired unused. Shopify's own usage
 * count is checked first, in case the orders/create webhook was missed.
 */
export async function expireCoupons(): Promise<{ checked: number; refunded: number; used: number }> {
  const pool = getPool();
  const r = await pool.query<{ id: string; customer_id: number; shopify_gid: string; code: string; discount_gid: string; points: number }>(
    `SELECT id::text, customer_id, shopify_gid, code, discount_gid, points
       FROM loyalty_coupons
      WHERE used_at IS NULL AND refunded_ledger_id IS NULL AND expires_at < now()
      ORDER BY expires_at
      LIMIT 100`,
  );
  let refunded = 0;
  let used = 0;
  for (const c of r.rows) {
    const d = await shopifyGraphQL<{
      codeDiscountNode: { codeDiscount: { asyncUsageCount?: number } } | null;
    }>(
      `query U($id: ID!) { codeDiscountNode(id: $id) { codeDiscount { ... on DiscountCodeBasic { asyncUsageCount } } } }`,
      { id: c.discount_gid },
    );
    if ((d.codeDiscountNode?.codeDiscount.asyncUsageCount ?? 0) > 0) {
      await pool.query(`UPDATE loyalty_coupons SET used_at = now() WHERE id = $1`, [c.id]);
      used++;
      continue;
    }
    await withTransaction(async (client) => {
      const led = await insertLedger(client, {
        customer_id: c.customer_id,
        shopify_gid: c.shopify_gid,
        delta_points: c.points,
        reason: "adjustment",
        source: "system",
        source_ref: `coupon-expired:${c.code}`,
        amount_basis: null,
      });
      await client.query(`UPDATE loyalty_coupons SET refunded_ledger_id = $2 WHERE id = $1`, [c.id, led.id]);
    });
    refunded++;
  }
  return { checked: r.rows.length, refunded, used };
}

async function balanceOf(client: PoolClient, customerId: number): Promise<number> {
  const b = await client.query<{ b: string }>(
    `SELECT COALESCE(SUM(delta_points), 0)::text AS b FROM loyalty_ledger WHERE customer_id = $1`,
    [customerId],
  );
  return Number(b.rows[0]?.b ?? 0);
}
