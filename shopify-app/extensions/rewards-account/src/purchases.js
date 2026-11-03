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
  if (!res.ok) throw new Error('store');
  return (await res.json()).purchases;
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
