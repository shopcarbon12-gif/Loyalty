import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { reverseOnlineOrderPoints } from "@/lib/orders";
import { getSettings } from "@/lib/settings";

/**
 * POST /api/shopify/webhooks/refunds-create
 *
 * Partial refunds. Shopify fires this on every refund; we pro-rate the
 * earn reversal based on `refund.subtotal` / `order.subtotal_price`.
 *
 * Payload shape (relevant fields):
 *   {
 *     order_id, admin_graphql_api_id, total_refund: "...",
 *     refund_line_items: [{ subtotal: "..." }, ...]
 *   }
 *
 * We look up the order's earn row by its admin_graphql_api_id and
 * compute a pro-rata reversal.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) {
    return NextResponse.json({ error: "invalid_hmac" }, { status: 401 });
  }
  let body: {
    admin_graphql_api_id?: string;
    order_id?: number;
    refund_line_items?: Array<{ subtotal?: string }>;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  if (!body.order_id) return NextResponse.json({ ok: true, skipped: "no_order_id" });
  const settings = await getSettings();
  if (!settings.live) return NextResponse.json({ ok: true, skipped: "live_off" });
  const orderGid = `gid://shopify/Order/${body.order_id}`;
  const refundGid = body.admin_graphql_api_id ?? `shopify:refund:${body.order_id}:${Date.now()}`;

  // Share of the order's points-eligible amount being refunded.
  const basis = await getPool().query<{ amount_basis: string | null }>(
    `SELECT amount_basis::text FROM loyalty_ledger WHERE source = 'shopify' AND source_ref = $1 LIMIT 1`,
    [orderGid],
  );
  if (!basis.rows[0]) return NextResponse.json({ ok: true, skipped: "no_original" });
  const refundedSubtotal = (body.refund_line_items ?? [])
    .reduce((s, li) => s + Number(li.subtotal ?? 0), 0);
  const origAmount = Number(basis.rows[0].amount_basis ?? 0);
  const share = origAmount > 0 ? refundedSubtotal / origAmount : 1;
  try {
    const r = await reverseOnlineOrderPoints(orderGid, { kind: "refund", refundGid, share, amount: refundedSubtotal });
    return NextResponse.json({ ok: true, reversed: r });
  } catch (err) {
    console.error("[refunds-create]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
