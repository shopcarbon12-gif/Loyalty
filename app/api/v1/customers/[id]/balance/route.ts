import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { isAuthorizedServerCall } from "@/lib/auth";
import { dollarsForPoints, getBalance } from "@/lib/loyalty";

/**
 * GET /api/v1/customers/:id/balance
 *
 * Server-to-server. POS calls on customer-attach to populate the balance
 * pill in TotalPanel. Returns balance, tier (when configured), and the
 * 5 most recent ledger entries for the right-side activity feed.
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
  return NextResponse.json({
    customer_id: customerId,
    balance,
    dollars_value: dollars,
    tier: null, // populated in B6
    recent: recent.rows,
  });
}
