import { NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import {
  insertLedger,
  pointsForEligible,
  withTransaction,
} from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";
import { markCouponsUsed } from "@/lib/coupons";
import {
  resolveShopifyCustomer,
  type ShopifyCustomerPayload,
} from "@/lib/shopify-customers";

/**
 * POST /api/shopify/webhooks/orders-create
 *
 * Shopify fires this when an online order is placed. We compute the
 * eligible amount (subtotal − discount − gift-card lines, tax NOT
 * counted) and write a ledger row.
 *
 * Idempotent — keyed on (source='shopify', source_ref=order.gid).
 * Multiple webhook deliveries for the same order produce one row.
 *
 * Sales originating from our own POS push (sourceName='carbon-pos')
 * are SKIPPED here — POS already wrote the earn ledger row at capture
 * time, and counting it again on the Shopify side would double-credit.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  let order: ShopifyOrder;
  try {
    order = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Live kill-switch — when OFF we 200 Shopify (no retry) but write nothing.
  const settings = await getSettings();
  if (!settings.live) {
    return NextResponse.json({ ok: true, skipped: "live_off" });
  }

  // Skip our own POS push so we don't double-count.
  if (order.source_name === "carbon-pos") {
    return NextResponse.json({ ok: true, skipped: "pos_origin" });
  }

  // Reward codes issued from the customer account — mark them spent.
  await markCouponsUsed(
    (order.discount_codes ?? []).map((d) => d.code ?? ""),
    order.admin_graphql_api_id,
  ).catch((err) => console.error("[orders-create] markCouponsUsed", err));

  const customerGid = order.customer?.admin_graphql_api_id ?? null;
  if (!customerGid) {
    return NextResponse.json({ ok: true, skipped: "no_customer" });
  }

  const eligible = computeEligible(order, settings);
  const points = await pointsForEligible(eligible);
  const sourceRef = order.admin_graphql_api_id; // gid://shopify/Order/123

  try {
    const result = await withTransaction(async (client) => {
      // Link (or create) the member so online orders always credit
      // someone — see lib/shopify-customers.ts.
      const { customerId } = await resolveShopifyCustomer(client, customerGid, order.customer ?? {});
      return insertLedger(client, {
        customer_id: customerId,
        shopify_gid: customerGid,
        delta_points: points,
        reason: "sale",
        source: "shopify",
        source_ref: sourceRef,
        amount_basis: eligible,
      });
    });
    return NextResponse.json({
      ok: true,
      ledger_id: result.id,
      points_awarded: points,
      new_balance: result.new_balance,
    });
  } catch (err) {
    console.error("[orders-create]", err);
    // Always 200 to Shopify so they don't keep retrying — we'd rather
    // log + investigate than have webhook backpressure.
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 200 });
  }
}

type ShopifyOrder = {
  admin_graphql_api_id: string;
  source_name?: string;
  discount_codes?: Array<{ code?: string }>;
  subtotal_price?: string;
  total_discounts?: string;
  total_tax?: string;
  customer?: ShopifyCustomerPayload & { id?: number };
  line_items?: Array<{
    gift_card?: boolean;
    price?: string;
    quantity?: number;
  }>;
};

/**
 * Compute the points-eligible amount for a Shopify order:
 *   subtotal − total_discounts − gift_card_line_value
 * (Tax is not in subtotal_price by default for Shopify orders, so we
 *  don't have to subtract it explicitly.)
 */
function computeEligible(o: ShopifyOrder, s: { exclude_gift_card_purchases: boolean }): number {
  const subtotal = Number(o.subtotal_price ?? 0);
  const discount = Number(o.total_discounts ?? 0);
  let giftCardValue = 0;
  if (s.exclude_gift_card_purchases) {
    for (const li of o.line_items ?? []) {
      if (li.gift_card) {
        const p = Number(li.price ?? 0) * (li.quantity ?? 1);
        giftCardValue += p;
      }
    }
  }
  return Math.max(0, subtotal - discount - giftCardValue);
}
