import { NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { upsertShopifyOrder, type ShopifyOrderPayload } from "@/lib/orders";

/**
 * POST /api/shopify/webhooks/orders-updated
 *
 * Keeps the order history (shopify_orders) current — fulfillment, refunds,
 * cancellation, edits — for POS / WMS / customer account. A full refund or
 * cancellation also returns any reward-code points (lib/orders.ts).
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookHmac(raw, req.headers.get("x-shopify-hmac-sha256"))) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  let order: ShopifyOrderPayload;
  try {
    order = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  if (!order.admin_graphql_api_id) return NextResponse.json({ ok: true, skipped: "no_gid" });
  try {
    await upsertShopifyOrder(order);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[orders-updated]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
