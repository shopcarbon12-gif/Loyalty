import { getPool } from "@/lib/db";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";
import { memberSummary } from "@/lib/member-summary";

/**
 * GET /api/account/summary
 *
 * Powers the Rewards page in Shopify customer accounts
 * (shopify-app/extensions/rewards-account). See lib/member-summary.ts.
 */
export async function GET(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);
  const c = await getPool().query<{ id: number; first_name: string | null }>(
    `SELECT id, first_name FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  return corsJson(await memberSummary(c.rows[0] ?? null));
}

export function OPTIONS() {
  return corsPreflight();
}
