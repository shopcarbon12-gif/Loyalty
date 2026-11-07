import { getPool } from "@/lib/db";
import { isWholesaleCustomer, WHOLESALE_MESSAGE } from "@/lib/wholesale";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";
import { storePurchases } from "@/lib/customer-purchases";

/**
 * GET /api/account/purchases
 *
 * In-store (Carbon POS) purchases for the signed-in customer, with the points
 * each earned — the "Purchases" page in customer accounts. Online orders come
 * from Shopify's Customer Account API in the extension itself.
 */
export async function GET(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);
  if (await isWholesaleCustomer(session.customerGid)) {
    return corsJson({ error: "wholesale", message: WHOLESALE_MESSAGE }, 403);
  }
  const c = await getPool().query<{ id: number }>(
    `SELECT id FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  if (!c.rows[0]) return corsJson({ purchases: [] });
  return corsJson({ purchases: await storePurchases(c.rows[0].id) });
}

export function OPTIONS() {
  return corsPreflight();
}
