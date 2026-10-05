import { getPool } from "@/lib/db";
import { cancelCoupon, RedeemError } from "@/lib/coupons";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";

/**
 * POST /api/account/cancel  { code }
 *
 * Cancels the signed-in member's unused reward code and returns its points,
 * so they can pick a different reward. See cancelCoupon in lib/coupons.ts.
 */
export async function POST(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const code = typeof body.code === "string" ? body.code : "";

  const c = await getPool().query<{ id: number }>(
    `SELECT id FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  if (!c.rows[0] || !code) return corsJson({ error: "not_found", message: "That code is no longer active." }, 404);

  try {
    return corsJson({ ok: true, ...(await cancelCoupon(c.rows[0].id, code)) });
  } catch (err) {
    if (err instanceof RedeemError) return corsJson({ error: err.code, message: err.message }, err.status);
    console.error("[/api/account/cancel]", err);
    return corsJson({ error: "server_error", message: "Something went wrong — please try again." }, 500);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
