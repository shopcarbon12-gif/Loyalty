import { NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { getSettings } from "@/lib/settings";
import { reverseOnlineOrderPoints, upsertShopifyOrder, type ShopifyOrderPayload } from "@/lib/orders";

/**
 * POST /api/shopify/webhooks/orders-cancelled
 *
 * Shopify fires this when an order is cancelled. We reverse any earn
 * ledger row that was written for this order (idempotent on
 * source_ref=`shopify:cancel:<order_gid>`, capped so a refund for the same
 * cancellation never doubles it), update the order history, and
 * give back the points of any reward code the order used.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  let order: ShopifyOrderPayload;
  try {
    order = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const orderGid = order.admin_graphql_api_id;
  if (!orderGid) return NextResponse.json({ ok: true, skipped: "no_gid" });
  await upsertShopifyOrder(order).catch((err) => console.error("[orders-cancelled] upsert", err));

  const settings = await getSettings();
  if (!settings.live) return NextResponse.json({ ok: true, skipped: "live_off" });

  try {
    // Takes back whatever the order's points still are — 0 if the matching
    // refunds/create already did (lib/orders.ts).
    const r = await reverseOnlineOrderPoints(orderGid, { kind: "cancel" });
    return NextResponse.json({ ok: true, reversed: r });
  } catch (err) {
    console.error("[orders-cancelled]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
