import { getPool, withTransaction } from "./db";
import { insertLedger } from "./loyalty";

/**
 * Online order history (shopify_orders), fed by the orders/* webhooks and
 * read through the customer_purchases view by POS, WMS and the customer
 * account. Payload is Shopify's REST order JSON (the webhook body).
 */
export type ShopifyOrderPayload = {
  admin_graphql_api_id: string;
  name?: string;
  email?: string | null;
  created_at?: string;
  processed_at?: string;
  currency?: string;
  subtotal_price?: string;
  total_discounts?: string;
  total_tax?: string;
  total_price?: string;
  total_shipping_price_set?: { shop_money?: { amount?: string } };
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  order_status_url?: string | null;
  discount_codes?: Array<{ code?: string }>;
  customer?: { admin_graphql_api_id?: string } | null;
  line_items?: Array<{
    title?: string;
    variant_title?: string | null;
    sku?: string | null;
    quantity?: number;
    price?: string;
  }>;
};

export async function upsertShopifyOrder(o: ShopifyOrderPayload): Promise<void> {
  const customerGid = o.customer?.admin_graphql_api_id ?? null;
  const codes = (o.discount_codes ?? []).map((d) => (d.code ?? "").trim().toUpperCase()).filter(Boolean);
  const lines = (o.line_items ?? []).map((li) => ({
    title: li.title ?? "",
    variant_title: li.variant_title ?? null,
    sku: li.sku ?? null,
    quantity: li.quantity ?? 0,
    price: li.price ?? null,
  }));
  await getPool().query(
    `INSERT INTO shopify_orders
       (order_gid, order_name, customer_id, shopify_customer_gid, email, processed_at, currency,
        subtotal, total_discounts, total_shipping, total_tax, total, financial_status,
        fulfillment_status, cancelled_at, discount_codes, line_items, status_url, updated_at)
     VALUES ($1, $2, (SELECT id FROM pos_customers WHERE shopify_customer_gid = $3 ORDER BY id LIMIT 1),
             $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now())
     ON CONFLICT (order_gid) DO UPDATE SET
       order_name = EXCLUDED.order_name,
       customer_id = COALESCE(EXCLUDED.customer_id, shopify_orders.customer_id),
       shopify_customer_gid = COALESCE(EXCLUDED.shopify_customer_gid, shopify_orders.shopify_customer_gid),
       email = EXCLUDED.email, currency = EXCLUDED.currency, subtotal = EXCLUDED.subtotal,
       total_discounts = EXCLUDED.total_discounts, total_shipping = EXCLUDED.total_shipping,
       total_tax = EXCLUDED.total_tax, total = EXCLUDED.total,
       financial_status = EXCLUDED.financial_status, fulfillment_status = EXCLUDED.fulfillment_status,
       cancelled_at = EXCLUDED.cancelled_at, discount_codes = EXCLUDED.discount_codes,
       line_items = EXCLUDED.line_items, status_url = EXCLUDED.status_url, updated_at = now()`,
    [
      o.admin_graphql_api_id,
      o.name ?? "",
      customerGid,
      o.email ?? null,
      o.processed_at ?? o.created_at ?? new Date().toISOString(),
      o.currency ?? null,
      num(o.subtotal_price),
      num(o.total_discounts),
      num(o.total_shipping_price_set?.shop_money?.amount),
      num(o.total_tax),
      num(o.total_price),
      o.financial_status ?? null,
      o.fulfillment_status ?? null,
      o.cancelled_at ?? null,
      codes,
      JSON.stringify(lines),
      o.order_status_url ?? null,
    ],
  );
  if (o.cancelled_at || o.financial_status === "refunded") {
    await returnRewardCodePoints(o.admin_graphql_api_id, codes);
  }
}

/**
 * A cancelled or fully refunded order gives back the points of any reward
 * code it used. Idempotent per code (ledger source_ref coupon-returned:<code>).
 */
export async function returnRewardCodePoints(orderGid: string, codes: string[]): Promise<number> {
  const ours = codes.filter((c) => c.startsWith("CR-"));
  if (!ours.length) return 0;
  const r = await getPool().query<{ id: string; customer_id: number; shopify_gid: string; code: string; points: number }>(
    `SELECT id::text, customer_id, shopify_gid, code, points FROM loyalty_coupons
      WHERE code = ANY($1::text[]) AND refunded_ledger_id IS NULL
        AND (used_order_gid IS NULL OR used_order_gid = $2)`,
    [ours, orderGid],
  );
  for (const c of r.rows) {
    await withTransaction(async (client) => {
      const led = await insertLedger(client, {
        customer_id: c.customer_id,
        shopify_gid: c.shopify_gid,
        delta_points: c.points,
        reason: "adjustment",
        source: "system",
        source_ref: `coupon-returned:${c.code}`,
        amount_basis: null,
      });
      await client.query(
        `UPDATE loyalty_coupons SET refunded_ledger_id = $2, used_at = COALESCE(used_at, now()),
                used_order_gid = COALESCE(used_order_gid, $3)
          WHERE id = $1`,
        [c.id, led.id, orderGid],
      );
    });
  }
  return r.rows.length;
}

function num(v: string | undefined | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
