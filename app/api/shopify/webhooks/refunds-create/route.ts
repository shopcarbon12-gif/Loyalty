import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { verifyWebhookHmac } from "@/lib/shopify-hmac";
import { insertLedger, withTransaction } from "@/lib/loyalty";

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
  const orderGid = `gid://shopify/Order/${body.order_id}`;
  const refundGid = body.admin_graphql_api_id ?? `shopify:refund:${body.order_id}:${Date.now()}`;

  // Original earn row.
  const orig = await getPool().query<{
    id: string;
    customer_id: number | null;
    shopify_gid: string | null;
    delta_points: number;
    amount_basis: string | null;
  }>(
    `SELECT id::text, customer_id, shopify_gid, delta_points, amount_basis::text
       FROM loyalty_ledger
      WHERE source = 'shopify' AND source_ref = $1
      LIMIT 1`,
    [orderGid],
  );
  if (orig.rowCount === 0) {
    return NextResponse.json({ ok: true, skipped: "no_original" });
  }
  const o = orig.rows[0];
  const refundedSubtotal = (body.refund_line_items ?? [])
    .reduce((s, li) => s + Number(li.subtotal ?? 0), 0);
  const origAmount = Number(o.amount_basis ?? 0);
  const pct = origAmount > 0 ? Math.min(1, refundedSubtotal / origAmount) : 1;
  const reverseDelta = -Math.round(o.delta_points * pct);
  if (reverseDelta === 0) {
    return NextResponse.json({ ok: true, skipped: "zero_pct" });
  }
  try {
    const result = await withTransaction((client) =>
      insertLedger(client, {
        customer_id: o.customer_id,
        shopify_gid: o.shopify_gid,
        delta_points: reverseDelta,
        reason: "refund",
        source: "shopify",
        source_ref: refundGid,
        amount_basis: refundedSubtotal,
      }),
    );
    return NextResponse.json({
      ok: true,
      reversed: { ledger_id: result.id, delta_points: reverseDelta },
    });
  } catch (err) {
    console.error("[refunds-create]", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
