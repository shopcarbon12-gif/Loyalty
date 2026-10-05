import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { isAuthorizedServerCall } from "@/lib/auth";
import { dollarsForPoints, getBalance } from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";
import { memberTier } from "@/lib/tiers";

/**
 * GET /api/v1/customers/:id/balance
 *
 * Server-to-server. POS calls on customer-attach to populate the balance
 * pill in TotalPanel. Returns balance, tier (when configured), and the
 * 5 most recent ledger entries for the right-side activity feed, plus the
 * live redemption rules so POS doesn't hard-code them.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const customerId = Number(id);
  if (!Number.isFinite(customerId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const balance = await getBalance(customerId);
  const dollars = await dollarsForPoints(balance);
  const recent = await getPool().query(
    `SELECT id, delta_points, reason, source, source_ref, created_at
       FROM loyalty_ledger
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 5`,
    [customerId],
  );
  const s = await getSettings();
  const t = await memberTier(customerId);
  return NextResponse.json({
    customer_id: customerId,
    balance,
    dollars_value: dollars,
    tier: t.tier ? t.tier.name : null,
    earn_multiplier: t.tier?.earn_multiplier ?? 1,
    recent: recent.rows,
    rules: {
      live: s.live,
      redeem_points_per_dollar: s.redeem_points_per_dollar,
      redeem_increment_points: s.redeem_increment_points,
      min_redeem_points: s.min_redeem_points,
      max_redeem_pct_of_order: s.max_redeem_pct_of_order,
      max_redeem_dollars_per_order: s.max_redeem_dollars_per_order,
    },
  });
}
