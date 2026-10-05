import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import {
  customerPhone,
  posPhone,
  resolveShopifyCustomer,
  type ShopifyCustomerPayload,
} from "@/lib/shopify-customers";

/**
 * POST /api/shopify/webhooks/customers-update
 *
 * Shopify fires this on any change to a storefront customer. We mirror
 * first_name / last_name / email / phone into pos_customers (shared with
 * POS and WMS). Phone is the customer-level phone, or the default address
 * phone when that's empty — which is what customers edit in their account.
 * Customers we haven't linked yet are linked (or created) first.
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
  let c: ShopifyCustomerPayload;
  try {
    c = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const gid = c.admin_graphql_api_id;
  if (!gid) return NextResponse.json({ ok: true, skipped: "no_gid" });

  try {
    const result = await withTransaction(async (client) => {
      const { customerId, created } = await resolveShopifyCustomer(client, gid, c);
      const r = await client.query(
        `UPDATE pos_customers
            SET first_name = COALESCE($2, first_name),
                last_name  = COALESCE($3, last_name),
                email      = COALESCE($4, email),
                -- keep a changed number reachable at the till: the old one
                -- moves into an empty phone_2 instead of being lost
                phone_2    = CASE WHEN $5::text IS NOT NULL AND phone IS NOT NULL AND phone <> $5
                                   AND phone_2 IS NULL THEN phone ELSE phone_2 END,
                phone      = COALESCE($5, phone)
          WHERE id = $1`,
        [customerId, c.first_name || null, c.last_name || null, c.email || null, posPhone(customerPhone(c))],
      );
      return { customer_id: customerId, created, updated: r.rowCount ?? 0 };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[customers-update]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
