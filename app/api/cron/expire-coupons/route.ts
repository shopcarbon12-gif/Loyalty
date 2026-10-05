import { NextResponse } from "next/server";
import { isAuthorizedServerCall } from "@/lib/auth";
import { expireCoupons } from "@/lib/coupons";

/**
 * POST /api/cron/expire-coupons
 *
 * Credits back points for online reward codes that expired unused. Run
 * hourly by a Coolify scheduled task on this app (bearer LOYALTY_API_KEY).
 */
export async function POST(req: Request) {
  if (!isAuthorizedServerCall(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await expireCoupons()) });
  } catch (err) {
    console.error("[expire-coupons]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
