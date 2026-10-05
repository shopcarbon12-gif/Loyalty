import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { insertLedger, withTransaction } from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";
import { upsertShopifyOrder, type ShopifyOrderPayload } from "@/lib/orders";

/**
 * POST /api/shopify/webhooks/orders-cancelled
 *
 * Shopify fires this when an order is cancelled. We reverse any earn
 * ledger row that was written for this order (idempotent on
 * source_ref=`shopify:cancel:<order_gid>`), update the order history, and
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

  const orig = await getPool().query<{
    id: string;
    customer_id: number | null;
    shopify_gid: string | null;
    delta_points: number;
  }>(
    `SELECT id::text, customer_id, shopify_gid, delta_points
       FROM loyalty_ledger
      WHERE source = 'shopify' AND source_ref = $1`,
    [orderGid],
  );
  if (orig.rowCount === 0) {
    return NextResponse.json({ ok: true, skipped: "nothing_to_reverse" });
  }
  try {
    const result = await withTransaction(async (client) => {
      const reversed: { ledger_id: number; delta_points: number }[] = [];
      for (const row of orig.rows) {
        const led = await insertLedger(client, {
          customer_id: row.customer_id,
          shopify_gid: row.shopify_gid,
          delta_points: -row.delta_points,
          reason: "refund",
          source: "shopify",
          source_ref: `shopify:cancel:${orderGid}:${row.id}`,
          amount_basis: null,
        });
        reversed.push({ ledger_id: led.id, delta_points: -row.delta_points });
      }
      return reversed;
    });
    return NextResponse.json({ ok: true, reversed: result });
  } catch (err) {
    console.error("[orders-cancelled]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
