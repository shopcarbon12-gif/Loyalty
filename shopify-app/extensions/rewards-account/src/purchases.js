// Purchases for the Member Club pages (Rewards and Purchases):
//  - online orders from Shopify's Customer Account API (the signed-in
//    customer's own orders; Shopify authenticates the request itself),
//  - in-store receipts from Carbon POS via rewards.shopcarbon.com.
// Either source can fail on its own; callers show what loaded.

const BASE = 'https://rewards.shopcarbon.com';
const CUSTOMER_ACCOUNT_API = 'shopify://customer-account/api/2026-07/graphql.json';

const ORDERS_QUERY = `query MemberClubOrders($first: Int!) {
  customer {
    orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id
        name
        processedAt
        cancelledAt
        financialStatus
        totalPrice { amount currencyCode }
        lineItems(first: 20) {
          nodes { name quantity image { url altText } }
        }
      }
    }
  }
}`;

// Editor previews run as a fake customer: labelled sample data only there.
const SAMPLE_ORDERS = [
  {
    id: 'gid://shopify/Order/1',
    name: '#1000',
    processedAt: new Date().toISOString(),
    cancelledAt: null,
    financialStatus: 'PAID',
    totalPrice: {amount: '58.50', currencyCode: 'USD'},
    lineItems: {nodes: [{name: 'Sample item', quantity: 1, image: null}]},
  },
];

const SAMPLE_STORE = [
  {
    number: 'S-1001',
    placed_at: new Date().toISOString(),
    total: 58.5,
    status: 'completed',
    store: 'Carbon store',
    lines: [{description: 'Sample item', quantity: 1, total: 58.5, type: 'product'}],
  },
];

export async function getOnlineOrders(first = 10) {
  if (shopify.extension.editor) return SAMPLE_ORDERS.slice(0, first);
  const res = await fetch(CUSTOMER_ACCOUNT_API, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({query: ORDERS_QUERY, variables: {first}}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors || !body.data?.customer) throw new Error('orders');
  return body.data.customer.orders.nodes;
}

export async function getStorePurchases() {
  if (shopify.extension.editor) return SAMPLE_STORE;
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${BASE}/api/account/purchases`, {headers: {Authorization: `Bearer ${token}`}});
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // 'wholesale' = a B2B buyer (rewards are retail-only); callers hide the section.
    throw Object.assign(new Error('store'), {code: body.error});
  }
  return (await res.json()).purchases;
}

/**
 * Points an online order earned (rewards.shopcarbon.com/api/account/order-points,
 * the same call the thank-you page uses). null when unknown or not earned yet.
 */
export async function getOrderPoints(order) {
  if (shopify.extension.editor) return 50;
  try {
    const token = await shopify.sessionToken.get();
    const res = await fetch(`${BASE}/api/account/order-points?order=${encodeURIComponent(order.id)}`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.status === 'earned' && body.points > 0 ? body.points : null;
  } catch {
    return null;
  }
}

/**
 * Online orders and in-store receipts as one list, newest first — the phone
 * layout's "Recent purchases". Each row: what was bought, where, when, the
 * total, a photo when the source has one, and the points it earned.
 */
export function mergePurchases(orders, store) {
  const online = (Array.isArray(orders) ? orders : []).map((o) => {
    const first = o.lineItems.nodes[0];
    const more = o.lineItems.nodes.length - 1;
    return {
      key: o.id,
      title: first ? `${first.name}${more > 0 ? ` + ${more} more` : ''}` : `Order ${o.name}`,
      where: 'Online',
      at: o.processedAt,
      total: o.totalPrice.amount,
      image: firstImage(o),
      status: orderStatus(o),
      points: o.points ?? null,
      href: orderUrl(o),
    };
  });
  const inStore = (Array.isArray(store) ? store : []).map((p) => {
    const products = p.lines.filter((l) => l.type !== 'loyalty_redemption');
    return {
      key: `store-${p.number}`,
      title: products[0]
        ? `${products[0].description}${products.length > 1 ? ` + ${products.length - 1} more` : ''}`
        : 'In-store purchase',
      where: 'In-store',
      at: p.placed_at,
      total: p.total,
      image: null,
      status: p.status === 'refunded' ? {label: 'Refunded', tone: 'neutral'} : null,
      points: p.points ?? null,
      href: 'extension:store-purchases/',
    };
  });
  return [...online, ...inStore].sort((a, b) => new Date(b.at) - new Date(a.at));
}

/** Shopify's own order page for an online order. */
export function orderUrl(order) {
  return `shopify:customer-account/orders/${String(order.id).split('/').pop()}`;
}

/** Badge for an online order that is not simply paid; null when nothing to flag. */
export function orderStatus(order) {
  if (order.cancelledAt) return {label: 'Canceled', tone: 'critical'};
  if (order.financialStatus === 'REFUNDED') return {label: 'Refunded', tone: 'neutral'};
  if (order.financialStatus === 'PARTIALLY_REFUNDED') return {label: 'Partly refunded', tone: 'neutral'};
  if (order.financialStatus === 'VOIDED') return {label: 'Voided', tone: 'critical'};
  if (order.financialStatus === 'PENDING' || order.financialStatus === 'AUTHORIZED') return {label: 'Payment pending', tone: 'warning'};
  return null;
}

export function itemCount(order) {
  return order.lineItems.nodes.reduce((n, l) => n + (l.quantity || 0), 0);
}

export function firstImage(order) {
  return order.lineItems.nodes.find((l) => l.image?.url)?.image ?? null;
}

export function money(amount) {
  const v = Number(amount) || 0;
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York'});
}
