import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const BASE = 'https://rewards.shopcarbon.com';

const SAMPLE = [
  {
    number: 'S-1001',
    placed_at: new Date().toISOString(),
    total: 58.5,
    status: 'completed',
    store: 'Carbon Orlando',
    lines: [{description: 'Ava Mini Dress — Black / L', quantity: 1, total: 58.5, type: 'product'}],
  },
];

export default async () => {
  render(<StorePurchases />, document.body);
};

function StorePurchases() {
  const [purchases, setPurchases] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Editor previews as a fake customer — show labelled sample data.
    if (shopify.extension.editor) return setPurchases(SAMPLE);
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${BASE}/api/account/purchases`, {headers: {Authorization: `Bearer ${token}`}});
        if (!res.ok) throw new Error();
        setPurchases((await res.json()).purchases);
      } catch {
        setError("We couldn't load your in-store purchases right now. Please try again in a moment.");
      }
    })();
  }, []);

  return (
    <s-page heading="In-store purchases" subheading="Purchases made at Carbon stores. Online orders are under Orders.">
      {error && (
        <s-banner tone="critical">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}
      {!purchases && !error && (
        <s-section>
          <s-spinner accessibilityLabel="Loading in-store purchases" />
        </s-section>
      )}
      {shopify.extension.editor && (
        <s-banner tone="info" heading="Editor preview">
          <s-paragraph>Sample data — customers see their own store purchases here.</s-paragraph>
        </s-banner>
      )}
      {purchases && purchases.length === 0 && (
        <s-section>
          <s-paragraph>No in-store purchases yet. Give your phone number or email at checkout to see them here.</s-paragraph>
        </s-section>
      )}
      {purchases?.map((p) => (
        <s-section key={p.number} heading={`${formatDate(p.placed_at)} · ${p.store || 'Carbon store'}`}>
          <s-stack gap="small-200">
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
            <s-divider />
            <s-grid gridTemplateColumns="1fr auto" gap="base">
              <s-text type="strong">
                Total{p.status === 'refunded' ? ' (refunded)' : ''} · Receipt {p.number}
              </s-text>
              <s-text type="strong">{money(p.total)}</s-text>
            </s-grid>
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

function money(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
}
