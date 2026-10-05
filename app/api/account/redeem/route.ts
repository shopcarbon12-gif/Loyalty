import { getPool } from "@/lib/db";
import { issueCoupon, RedeemError } from "@/lib/coupons";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";

/**
 * POST /api/account/redeem  { points }
 *
 * Trades points for a single-use discount code locked to the signed-in
 * customer. See lib/coupons.ts for the rules.
 */
export async function POST(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => ({}))) as { points?: unknown };
  const points = Number(body.points);

  const c = await getPool().query<{ id: number }>(
    `SELECT id FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  if (!c.rows[0]) return corsJson({ error: "not_linked", message: "No rewards balance yet." }, 404);

  try {
    return corsJson({ ok: true, coupon: await issueCoupon(c.rows[0].id, session.customerGid, points) });
  } catch (err) {
    if (err instanceof RedeemError) return corsJson({ error: err.code, message: err.message }, err.status);
    console.error("[/api/account/redeem]", err);
    return corsJson({ error: "server_error", message: "Something went wrong — please try again." }, 500);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
