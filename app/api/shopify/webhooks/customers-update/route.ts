import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";

/**
 * POST /api/shopify/webhooks/customers-update
 *
 * Shopify fires this on any change to a storefront customer. We mirror
 * first_name / last_name / email / phone into pos_customers, matched
 * by shopify_customer_gid. No-op if we don't have the customer linked
 * (the customers-create webhook should have done the linkage).
 *
 * Tags from Shopify are NOT synced into POS — matches the Kangaroo
 * setting confirmed during reverse-engineering ("Sync Customer Tags
 * = OFF" in their portal). POS tags stay POS-side.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  let c: ShopifyCustomer;
  try {
    c = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const gid = c.admin_graphql_api_id;
  if (!gid) return NextResponse.json({ ok: true, skipped: "no_gid" });

  try {
    const r = await getPool().query(
      `UPDATE pos_customers
          SET first_name   = COALESCE($2, first_name),
              last_name    = COALESCE($3, last_name),
              email        = COALESCE($4, email),
              phone        = COALESCE($5, phone)
        WHERE shopify_customer_gid = $1`,
      [gid, c.first_name ?? null, c.last_name ?? null, c.email ?? null, c.phone ?? null],
    );
    return NextResponse.json({ ok: true, updated: r.rowCount ?? 0 });
  } catch (err) {
    console.error("[customers-update]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

type ShopifyCustomer = {
  admin_graphql_api_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
};
