import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyAppProxySignature } from "@/lib/shopify-hmac";

/**
 * GET /apps/loyalty/activity
 *
 * Returns the latest 10 ledger rows for the logged-in storefront
 * customer. Powers the "Recent activity" list inside the widget's
 * expanded panel.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!verifyAppProxySignature(url)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id");
  if (!shopifyCustomerId) {
    return NextResponse.json({ activity: [] });
  }
  const gid = `gid://shopify/Customer/${shopifyCustomerId}`;
  const r = await getPool().query(
    `SELECT l.id, l.delta_points, l.reason, l.amount_basis, l.created_at
       FROM loyalty_ledger l
       JOIN pos_customers pc ON pc.id = l.customer_id
      WHERE pc.shopify_customer_gid = $1
      ORDER BY l.created_at DESC
      LIMIT 10`,
    [gid],
  );
  return NextResponse.json({ activity: r.rows });
}
