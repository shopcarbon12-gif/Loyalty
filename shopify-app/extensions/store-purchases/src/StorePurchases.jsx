import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {
  firstImage,
  formatDate,
  getOnlineOrders,
  getStorePurchases,
  itemCount,
  money,
  orderStatus,
  orderUrl,
} from '../../rewards-account/src/purchases.js';

// Carbon Member Club — Purchases: online orders (Shopify's Customer Account
// API; each links to Shopify's own order page, where details, refunds and Buy
// again live) and in-store purchases (Carbon POS receipts via
// rewards.shopcarbon.com). The two load separately, so one source being down
// never hides the other.

export default async () => {
  render(<Purchases />, document.body);
};

function Purchases() {
  const [orders, setOrders] = useState(undefined);
  const [store, setStore] = useState(undefined);

  useEffect(() => {
    getOnlineOrders(10)
      .then(setOrders)
      .catch(() => setOrders('error'));
    getStorePurchases()
      .then(setStore)
      .catch(() => setStore('error'));
  }, []);

  return (
    <s-page heading="Purchases" subheading="Your online orders and Carbon store purchases">
      {shopify.extension.editor && (
        <s-banner tone="info" heading="Editor preview">
          <s-paragraph>Sample data — customers see their own purchases here.</s-paragraph>
        </s-banner>
      )}

      <s-section heading="Online orders">
        <s-stack gap="base">
          {orders === undefined && <s-spinner accessibilityLabel="Loading online orders" />}
          {orders === 'error' && (
            <s-text color="subdued">We couldn't load your online orders right now. Please try again in a moment.</s-text>
          )}
          {Array.isArray(orders) && orders.length === 0 && <s-text color="subdued">No online orders yet.</s-text>}
          {Array.isArray(orders) &&
            orders.map((o, i) => (
              <s-stack key={o.id} gap="base">
                {i > 0 && <s-divider />}
                <OnlineOrder order={o} />
              </s-stack>
            ))}
          <s-link href="shopify:customer-account/orders">All online orders</s-link>
        </s-stack>
      </s-section>

      <s-section heading="In-store purchases">
        <s-stack gap="base">
          {store === undefined && <s-spinner accessibilityLabel="Loading in-store purchases" />}
          {store === 'error' && (
            <s-text color="subdued">We couldn't load your in-store purchases right now. Please try again in a moment.</s-text>
          )}
          {Array.isArray(store) && store.length === 0 && (
            <s-text color="subdued">
              No in-store purchases yet. Give your phone number or email at checkout to see them here.
            </s-text>
          )}
          {Array.isArray(store) &&
            store.map((p, i) => (
              <s-stack key={p.number} gap="base">
                {i > 0 && <s-divider />}
                <StoreReceipt purchase={p} />
              </s-stack>
            ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function OnlineOrder({order}) {
  const img = firstImage(order);
  const status = orderStatus(order);
  const n = itemCount(order);
  return (
    <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
      {img ? <s-product-thumbnail src={img.url} alt={img.altText || ''} /> : <s-icon type="order" />}
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text type="strong">Order {order.name}</s-text>
          {status && <s-badge tone={status.tone}>{status.label}</s-badge>}
        </s-stack>
        <s-text>
          {n} {n === 1 ? 'item' : 'items'} · {money(order.totalPrice.amount)} · placed {formatDate(order.processedAt)}
          {order.cancelledAt ? ` · canceled ${formatDate(order.cancelledAt)}` : ''}
        </s-text>
        <s-link href={orderUrl(order)}>View order</s-link>
      </s-stack>
    </s-grid>
  );
}

function StoreReceipt({purchase: p}) {
  const refunded = p.status === 'refunded';
  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <s-icon type="store" />
        <s-text type="strong">
          {formatDate(p.placed_at)} · {p.store || 'Carbon store'}
        </s-text>
        {refunded && <s-badge tone="neutral">Refunded</s-badge>}
      </s-stack>
      {p.lines
        .filter((l) => l.type !== 'loyalty_redemption')
        .map((l, i) => (
          <s-grid key={i} gridTemplateColumns="1fr auto" gap="base">
            <s-text>
              {l.description}
              {l.quantity > 1 ? ` × ${l.quantity}` : ''}
            </s-text>
            <s-text>{money(l.total)}</s-text>
          </s-grid>
        ))}
      {p.lines
        .filter((l) => l.type === 'loyalty_redemption')
        .map((l, i) => (
          <s-grid key={`r${i}`} gridTemplateColumns="1fr auto" gap="base">
            <s-text color="subdued">Carbon Rewards</s-text>
            <s-text color="subdued">{money(l.total)}</s-text>
          </s-grid>
        ))}
      <s-grid gridTemplateColumns="1fr auto" gap="base">
        <s-text type="strong">
          Total{refunded ? ' (refunded)' : ''} · Receipt {p.number}
        </s-text>
        <s-text type="strong">{money(p.total)}</s-text>
      </s-grid>
    </s-stack>
  );
}
