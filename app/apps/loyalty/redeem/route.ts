import { NextResponse } from "next/server";
import { issueCoupon, RedeemError } from "@/lib/coupons";
import { proxyCustomer } from "@/lib/proxy-customer";

/**
 * POST /apps/loyalty/redeem  { points }
 *
 * App proxy twin of /api/account/redeem for the cart box: trades points for
 * a single-use code the theme then applies to the cart.
 */
export async function POST(req: Request) {
  const pc = await proxyCustomer(req, { fresh: true });
  if (!pc.ok) return pc.res;
  if (!pc.customerId) return NextResponse.json({ error: "not_linked", message: "No rewards balance yet." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { points?: unknown };
  try {
    return NextResponse.json({ ok: true, coupon: await issueCoupon(pc.customerId, pc.gid, Number(body.points)) });
  } catch (err) {
    if (err instanceof RedeemError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    console.error("[/apps/loyalty/redeem]", err);
    return NextResponse.json({ error: "server_error", message: "Something went wrong — please try again." }, { status: 500 });
  }
}
