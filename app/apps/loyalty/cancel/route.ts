import { NextResponse } from "next/server";
import { cancelCoupon, RedeemError } from "@/lib/coupons";
import { proxyCustomer } from "@/lib/proxy-customer";

/**
 * POST /apps/loyalty/cancel  { code }
 *
 * App proxy twin of /api/account/cancel for the cart box.
 */
export async function POST(req: Request) {
  const pc = await proxyCustomer(req, { fresh: true });
  if (!pc.ok) return pc.res;
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code : "";
  if (!pc.customerId || !code) {
    return NextResponse.json({ error: "not_found", message: "That code is no longer active." }, { status: 404 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await cancelCoupon(pc.customerId, code)) });
  } catch (err) {
    if (err instanceof RedeemError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    console.error("[/apps/loyalty/cancel]", err);
    return NextResponse.json({ error: "server_error", message: "Something went wrong — please try again." }, { status: 500 });
  }
}
