import { NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import {
  insertLedger,
  pointsForEligible,
  withTransaction,
} from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";
import { markCouponsUsed } from "@/lib/coupons";
import { queueEmail } from "@/lib/email";
import { referralForOnlineOrder } from "@/lib/referrals";
import { upsertShopifyOrder, type ShopifyOrderPayload } from "@/lib/orders";
import {
  resolveShopifyCustomer,
  type ShopifyCustomerPayload,
} from "@/lib/shopify-customers";

/**
 * POST /api/shopify/webhooks/orders-create
 *
 * Shopify fires this when an online order is placed. We compute the
 * eligible amount (subtotal after discounts − gift-card lines, tax and
 * shipping NOT counted) and write a ledger row.
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
  const res = await earn(order);
  // Order history for POS / WMS / customer account — every order, after the
  // earn step so a just-linked member is attached.
  await upsertShopifyOrder(order as ShopifyOrderPayload).catch((err) =>
    console.error("[orders-create] upsertShopifyOrder", err),
  );
  return res;
}

async function earn(order: ShopifyOrder): Promise<NextResponse> {

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
  const sourceRef = order.admin_graphql_api_id; // gid://shopify/Order/123

  try {
    const result = await withTransaction(async (client) => {
      // Link (or create) the member so online orders always credit
      // someone — see lib/shopify-customers.ts.
      const { customerId } = await resolveShopifyCustomer(client, customerGid, order.customer ?? {});
      // Points use the member's tier multiplier, so they're computed once
      // the member is known.
      const points = await pointsForEligible(eligible, customerId, client);
      const led = await insertLedger(client, {
        customer_id: customerId,
        shopify_gid: customerGid,
        delta_points: points,
        reason: "sale",
        source: "shopify",
        source_ref: sourceRef,
        amount_basis: eligible,
      });
      // "You earned N points" email (the row only exists for members with an email).
      if (points > 0) {
        await queueEmail(client, {
          customerId,
          template: "points_earned",
          data: { points, where: "online" },
          ledgerId: led.id,
          dedupeKey: `earned:${sourceRef}`,
        });
      }
      // First qualifying order through a friend's link pays both sides.
      const refCode =
        order.note_attributes?.find((a) => a.name === "carbon_ref")?.value?.trim() || null;
      await referralForOnlineOrder(client, {
        refereeId: customerId,
        refereeGid: customerGid,
        orderGid: sourceRef,
        eligible,
        refCode,
      });
      return { ...led, points };
    });
    return NextResponse.json({
      ok: true,
      ledger_id: result.id,
      points_awarded: result.points,
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
  note_attributes?: Array<{ name?: string; value?: string }>;
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
 *   subtotal_price − gift_card_line_value
 * Shopify's subtotal_price is already after discounts (line + order level,
 * including reward codes) and before shipping, taxes and tips — so the
 * discount must NOT be subtracted again.
 */
function computeEligible(o: ShopifyOrder, s: { exclude_gift_card_purchases: boolean }): number {
  const subtotal = Number(o.subtotal_price ?? 0);
  let giftCardValue = 0;
  if (s.exclude_gift_card_purchases) {
    for (const li of o.line_items ?? []) {
      if (li.gift_card) {
        const p = Number(li.price ?? 0) * (li.quantity ?? 1);
        giftCardValue += p;
      }
    }
  }
  return Math.max(0, subtotal - giftCardValue);
}
