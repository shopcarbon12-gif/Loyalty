import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyAppProxySignature } from "@/lib/shopify-hmac";
import { dollarsForPoints, getBalance } from "@/lib/loyalty";

/**
 * GET /apps/loyalty/balance
 *
 * Shopify app proxy. The storefront widget calls
 * shopcarbon.com/apps/loyalty/balance, Shopify rewrites it to
 * loyalty.shopcarbon.com/apps/loyalty/balance with a `signature` query
 * param + a `logged_in_customer_id` (Shopify customer numeric ID, NOT
 * a GID).
 *
 * If the customer isn't logged into the storefront, Shopify omits
 * logged_in_customer_id — we return a "not_logged_in" payload and the
 * widget shows the "Sign in" CTA.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!verifyAppProxySignature(url)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id");
  if (!shopifyCustomerId) {
    return NextResponse.json({ logged_in: false });
  }
  // Match the storefront's numeric customer ID to our pos_customers row.
  // Storefront uses the numeric form `1234567890`; Admin GraphQL uses
  // `gid://shopify/Customer/1234567890`. We store the GID, so build it.
  const gid = `gid://shopify/Customer/${shopifyCustomerId}`;
  const r = await getPool().query<{ id: number; first_name: string; last_name: string | null }>(
    `SELECT id, first_name, last_name
       FROM pos_customers
      WHERE shopify_customer_gid = $1
      LIMIT 1`,
    [gid],
  );
  const row = r.rows[0];
  if (!row) {
    return NextResponse.json({
      logged_in: true,
      linked: false,
      message: "not yet linked to a POS customer",
    });
  }
  const balance = await getBalance(row.id);
  const dollars = await dollarsForPoints(balance);
  return NextResponse.json({
    logged_in: true,
    linked: true,
    customer_id: row.id,
    first_name: row.first_name,
    balance,
    dollars_value: dollars,
    tier: null, // populated in B6
  });
}
