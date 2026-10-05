import { getPool } from "@/lib/db";
import { corsJson, corsPreflight, verifyCustomerSession } from "@/lib/customer-session";
import { getBalance, pointsForEligible } from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";
import { shopifyGraphQL } from "@/lib/shopify";

/**
 * GET /api/account/order-points?order=<gid>
 *
 * "You earned N points" on the thank-you and order-status pages
 * (shopify-app/extensions/rewards-thank-you, rewards-order-status).
 * Returns the credited points once orders/create has run; until then the
 * same amount computed from the order the way the webhook will. Only for
 * the signed-in customer's own orders.
 */
export async function GET(req: Request) {
  const session = await verifyCustomerSession(req);
  if (!session) return corsJson({ error: "unauthorized" }, 401);
  // Thank-you pages expose an OrderIdentity gid with the same numeric id.
  const raw = new URL(req.url).searchParams.get("order") ?? "";
  const num = raw.match(/\/(\d+)$/)?.[1];
  if (!num) return corsJson({ error: "bad_order" }, 400);
  const orderGid = `gid://shopify/Order/${num}`;

  const pool = getPool();
  const member = await pool.query<{ id: number }>(
    `SELECT id FROM pos_customers WHERE shopify_customer_gid = $1 ORDER BY id LIMIT 1`,
    [session.customerGid],
  );
  const balance = member.rows[0] ? await getBalance(member.rows[0].id) : null;

  const led = await pool.query<{ delta_points: number; shopify_gid: string | null }>(
    `SELECT delta_points, shopify_gid FROM loyalty_ledger WHERE source = 'shopify' AND source_ref = $1`,
    [orderGid],
  );
  if (led.rows[0]) {
    if (led.rows[0].shopify_gid !== session.customerGid) return corsJson({ error: "not_found" }, 404);
    return corsJson({ status: "earned", points: led.rows[0].delta_points, balance });
  }

  const s = await getSettings();
  const data = await shopifyGraphQL<{
    order: {
      customer: { id: string } | null;
      cancelledAt: string | null;
      subtotalPriceSet: { shopMoney: { amount: string } } | null;
      lineItems: { nodes: { isGiftCard: boolean; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } } }[] };
    } | null;
  }>(
    `query O($id: ID!) {
       order(id: $id) {
         customer { id }
         cancelledAt
         subtotalPriceSet { shopMoney { amount } }
         lineItems(first: 100) { nodes { isGiftCard quantity originalUnitPriceSet { shopMoney { amount } } } }
       }
     }`,
    { id: orderGid },
  );
  const o = data.order;
  if (!o || o.customer?.id !== session.customerGid) return corsJson({ error: "not_found" }, 404);
  if (o.cancelledAt) return corsJson({ status: "cancelled", points: 0, balance });
  // Same rule as the orders/create webhook: subtotal after discounts − gift cards.
  let eligible = Number(o.subtotalPriceSet?.shopMoney.amount ?? 0);
  if (s.exclude_gift_card_purchases) {
    for (const li of o.lineItems.nodes) {
      if (li.isGiftCard) eligible -= Number(li.originalUnitPriceSet.shopMoney.amount) * li.quantity;
    }
  }
  const points = s.live ? await pointsForEligible(Math.max(0, eligible)) : 0;
  return corsJson({ status: "pending", points, balance });
}

export function OPTIONS() {
  return corsPreflight();
}
