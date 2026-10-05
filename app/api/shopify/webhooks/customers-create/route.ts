import { NextResponse } from "next/server";
import { withTransaction } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { insertLedger } from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";
import {
  resolveShopifyCustomer,
  type ShopifyCustomerPayload,
} from "@/lib/shopify-customers";

/**
 * POST /api/shopify/webhooks/customers-create
 *
 * Shopify fires this when a customer signs up on the storefront. We
 * link them to their in-store member (or create one) and award the
 * welcome bonus.
 *
 * Idempotent on (source='system', source_ref='welcome:<gid>') — the
 * unique ledger index prevents a second welcome bonus on retry.
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

  const settings = await getSettings();
  if (!settings.live) return NextResponse.json({ ok: true, skipped: "live_off" });

  const gid = c.admin_graphql_api_id;
  if (!gid) return NextResponse.json({ ok: true, skipped: "no_gid" });

  try {
    const result = await withTransaction(async (client) => {
      // Link to an existing in-store member (GID → email → phone) or
      // create a new one. See lib/shopify-customers.ts.
      const { customerId, wasLinked } = await resolveShopifyCustomer(client, gid, c);

      // Welcome bonus — idempotent on the unique source/source_ref index.
      // Skipped when the member was already linked: that's an in-store
      // customer our own sync just created in Shopify, not an online signup.
      const bonus = wasLinked ? 0 : settings.signup_bonus_points;
      let welcomeLed: { id: number; new_balance: number } | null = null;
      if (bonus > 0) {
        welcomeLed = await insertLedger(client, {
          customer_id: customerId,
          shopify_gid: gid,
          delta_points: bonus,
          reason: "signup_bonus",
          source: "system",
          source_ref: `welcome:${gid}`,
          amount_basis: null,
        });
      }
      return { customer_id: customerId, welcome_ledger: welcomeLed };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[customers-create]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
