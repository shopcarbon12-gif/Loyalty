import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {cancelCode, getSummary, reasonLabel, redeem, redeemOptions} from './api.js';
import {firstImage, formatDate, getOnlineOrders, getStorePurchases, itemCount, money, orderStatus, orderUrl} from './purchases.js';

// Carbon Member Club — Rewards (approved layout 2026-11-03). Shopify draws the
// header and account menu; this page is the content area: balance + redeem and
// the tier panel on top, referral and points activity below, then the latest
// online order and in-store receipt. Every figure comes from Carbon Rewards
// (rewards.shopcarbon.com) or Shopify; nothing here is sample data outside the
// checkout & accounts editor preview.

export default async () => {
  render(<RewardsPage />, document.body);
};

const TWO_COLUMNS = '@container (inline-size > 700px) 3fr 2fr, 1fr';
const HALVES = '@container (inline-size > 700px) 1fr 1fr, 1fr';
const ACTIVITY_SHOWN = 5;

function RewardsPage() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);
  const [issued, setIssued] = useState(null);
  const [cancelling, setCancelling] = useState('');

  const load = () =>
    getSummary()
      .then((s) => {
        setSummary(s);
        setError('');
      })
      .catch((e) =>
        setError(
          e.code === 'unauthorized'
            ? "We couldn't load your rewards right now. Please sign out and back in, then try again."
            : e.message,
        ),
      );

  useEffect(() => {
    load();
  }, []);

  async function onRedeem(points) {
    if (busy) return; // one redemption at a time; the server also refuses a second active code
    setBusy(points);
    setError('');
    try {
      const {coupon} = await redeem(points);
      setIssued(coupon);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(0);
    }
  }

  async function onCancel(code) {
    setCancelling(code);
    setError('');
    try {
      await cancelCode(code);
      setIssued(null);
      await load();
    } catch (e) {
      setError(e.message);
      await load();
    } finally {
      setCancelling('');
    }
  }

  if (!summary && !error) {
    return (
      <s-page heading="Rewards" subheading="Carbon Member Club">
        <s-section>
          <s-spinner accessibilityLabel="Loading your rewards" />
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Rewards" subheading="Carbon Member Club">
      {summary?.preview && (
        <s-banner tone="info" heading="Editor preview">
          <s-paragraph>Sample data — customers see their own points here.</s-paragraph>
        </s-banner>
      )}

      {error && (
        <s-banner tone="critical" heading="We couldn't complete that">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      )}

      {issued && (
        <s-banner tone="success" heading={`Your $${issued.dollars} code is ready`}>
          <s-paragraph>
            Enter it at checkout before {formatDate(issued.expires_at)} on items totaling ${issued.min_subtotal} or more.
            Changed your mind? Cancel it below to get your points back.
          </s-paragraph>
        </s-banner>
      )}

      {summary?.thank_you_codes?.length > 0 && <ThankYouCodes codes={summary.thank_you_codes} />}

      {summary && !summary.linked && (
        <s-section>
          <s-paragraph>Your points will appear here after your first purchase online or in store.</s-paragraph>
        </s-section>
      )}

      {summary?.linked && (
        <s-query-container>
          <s-stack gap="large">
            <s-grid gridTemplateColumns={TWO_COLUMNS} gap="large">
              <s-stack gap="large">
                <Balance summary={summary} />
                <Redeem summary={summary} busy={busy} cancelling={cancelling} onRedeem={onRedeem} onCancel={onCancel} />
              </s-stack>
              <Tier tier={summary.tier} />
            </s-grid>

            <s-grid gridTemplateColumns={TWO_COLUMNS} gap="large">
              {summary.referral ? <Referral referral={summary.referral} /> : <s-box />}
              <Activity activity={summary.activity ?? []} />
            </s-grid>

            <RecentPurchases />
          </s-stack>
        </s-query-container>
      )}
    </s-page>
  );
}

function Balance({summary}) {
  const rules = summary.rules;
  const options = redeemOptions(summary);
  const step = rules?.redeem_increment_points ?? 100;
  const stepDollars = step / (rules?.redeem_points_per_dollar ?? 10);
  return (
    <s-stack gap="small-200">
      <s-paragraph>
        Earn {rules?.earn_rate_per_dollar ?? 1} point for every $1 and turn {step} points into ${stepDollars} off.
      </s-paragraph>
      <s-heading>{summary.balance.toLocaleString()} points</s-heading>
      <s-text color="subdued">
        {options.length
          ? `Up to $${options[options.length - 1].dollars} off your next order`
          : `${Math.max(1, step - summary.balance)} more points to unlock $${stepDollars} off`}
      </s-text>
    </s-stack>
  );
}

function Redeem({summary, busy, cancelling, onRedeem, onCancel}) {
  const rules = summary.rules;
  const options = redeemOptions(summary);
  if (summary.codes?.length > 0) {
    return (
      <s-section heading="Your active code">
        <s-stack gap="base">
          {summary.codes.map((c) => (
            <s-stack key={c.code} gap="small-200">
              <s-text type="strong">${c.dollars} off your items</s-text>
              <s-text color="subdued">
                For items totaling ${c.min_subtotal} or more · shipping not included · expires {formatDate(c.expires_at)}
              </s-text>
              <CodeRow code={c.code} />
              <s-stack direction="inline">
                <s-button variant="secondary" tone="critical" loading={cancelling === c.code} onClick={() => onCancel(c.code)}>
                  Cancel code &amp; return {c.points} points
                </s-button>
              </s-stack>
            </s-stack>
          ))}
          <s-text color="subdued">
            One code at a time. Cancel this one to choose a different reward — unused codes also return their points
            automatically when they expire.
          </s-text>
        </s-stack>
      </s-section>
    );
  }
  if (!rules?.live || options.length === 0) return null;
  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="base">
        {options.map((o, i) => (
          <s-button
            key={o.points}
            variant={i === 0 ? 'primary' : 'secondary'}
            loading={busy === o.points}
            disabled={busy !== 0 && busy !== o.points}
            onClick={() => onRedeem(o.points)}
            accessibilityLabel={`Redeem $${o.dollars} off for ${o.points} points`}
          >
            Redeem ${o.dollars} off · {o.points} points
          </s-button>
        ))}
      </s-stack>
      <s-text color="subdued">One-time code · up to ${rules.max_redeem_dollars_per_order} off per purchase</s-text>
    </s-stack>
  );
}

function Tier({tier}) {
  if (!tier) return <s-box />;
  const next = tier.next;
  const progress = Number(tier.progress);
  const target = next ? progress + Number(next.needed) : 0;
  const showBar = next && target > 0 && Number.isFinite(progress) && progress >= 0;
  return (
    <s-section heading={`${tier.name} Tier`}>
      <s-stack gap="base">
        <s-text color="subdued">Current tier · {tier.multiplier}× points</s-text>
        {next ? (
          <s-stack gap="small-200">
            <s-text>{progressLabel(tier, target)}</s-text>
            {showBar && (
              <s-progress value={Math.min(progress, target)} max={target} accessibilityLabel={`Progress to ${next.name} tier`} />
            )}
          </s-stack>
        ) : (
          <s-text>You're at our top tier — thank you!</s-text>
        )}
        {tier.perks?.length > 0 && (
          <s-stack gap="small-200">
            {tier.perks.map((p) => (
              <s-stack key={p} direction="inline" gap="small-200" alignItems="center">
                <s-icon type="check" tone="info" />
                <s-text>{p}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}

// "202 / 500 points to Silver", "$120 / $500 spent toward Silver", "3 / 5 purchases toward Silver".
function progressLabel(tier, target) {
  const p = Math.floor(Number(tier.progress));
  const t = Math.ceil(target);
  if (tier.metric === 'points') return `${p.toLocaleString()} / ${t.toLocaleString()} points to ${tier.next.name}`;
  if (tier.metric === 'visits') return `${p} / ${t} purchases toward ${tier.next.name}`;
  return `$${p.toLocaleString()} / $${t.toLocaleString()} spent toward ${tier.next.name}`;
}

function Referral({referral}) {
  const [copy, setCopy] = useState('');
  return (
    <s-section heading={`Refer a friend. Earn ${referral.you_get} points.`}>
      <s-stack gap="base">
        <s-paragraph>
          Share your link. When a friend makes their first purchase of ${referral.min_purchase}+, they get{' '}
          {referral.friend_gets} points and you get {referral.you_get} points.
        </s-paragraph>
        <s-text type="strong">{referral.url}</s-text>
        <s-clipboard-item
          id="copy-referral"
          text={referral.url}
          onCopy={() => setCopy('ok')}
          onCopyError={() => setCopy('error')}
        />
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-button variant="secondary" commandFor="copy-referral">
            Copy referral link
          </s-button>
          {copy === 'ok' && <s-text tone="success">Link copied</s-text>}
          {copy === 'error' && <s-text tone="critical">Couldn't copy — select the link above instead</s-text>}
        </s-stack>
      </s-stack>
    </s-section>
  );
}

const ACTIVITY_ICONS = {
  sale: 'cart',
  refund: 'reset',
  redemption: 'discount-code',
  referral_bonus: 'person-add',
  signup_bonus: 'gift',
  birthday_bonus: 'gift',
};

function Activity({activity}) {
  const [all, setAll] = useState(false);
  const rows = all ? activity : activity.slice(0, ACTIVITY_SHOWN);
  return (
    <s-section heading="Points activity">
      {activity.length === 0 ? (
        <s-text color="subdued">No points activity yet.</s-text>
      ) : (
        <s-stack gap="base">
          {rows.map((a, i) => (
            <s-grid key={i} gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
              <s-icon type={ACTIVITY_ICONS[a.reason] ?? 'adjust'} />
              <s-stack gap="none">
                <s-text>
                  {a.source === 'system' && a.reason === 'adjustment'
                    ? 'Code cancelled or expired — points returned'
                    : reasonLabel(a.reason)}
                </s-text>
                <s-text color="subdued">{formatDate(a.created_at)}</s-text>
              </s-stack>
              <s-text type="strong" tone={a.delta_points < 0 ? 'neutral' : 'success'}>
                {a.delta_points > 0 ? '+' : ''}
                {a.delta_points} pts
              </s-text>
            </s-grid>
          ))}
          {activity.length > ACTIVITY_SHOWN && (
            <s-stack direction="inline">
              <s-button variant="secondary" onClick={() => setAll(!all)}>
                {all ? 'Show less' : `View all ${activity.length} recent`}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      )}
    </s-section>
  );
}

function RecentPurchases() {
  const [order, setOrder] = useState(undefined);
  const [receipt, setReceipt] = useState(undefined);
  useEffect(() => {
    getOnlineOrders(1)
      .then((o) => setOrder(o[0] ?? null))
      .catch(() => setOrder('error'));
    getStorePurchases()
      .then((p) => setReceipt(p[0] ?? null))
      .catch(() => setReceipt('error'));
  }, []);
  return (
    <s-grid gridTemplateColumns={HALVES} gap="large">
      <s-section heading="Recent purchases">
        <s-stack gap="base">
          {order === undefined && <s-spinner accessibilityLabel="Loading your latest order" />}
          {order === 'error' && <s-text color="subdued">We couldn't load your online orders right now.</s-text>}
          {order === null && <s-text color="subdued">No online orders yet.</s-text>}
          {order && order !== 'error' && <OrderCard order={order} />}
          <s-link href="shopify:customer-account/orders">View all orders</s-link>
        </s-stack>
      </s-section>
      <s-section heading="In-store purchase">
        <s-stack gap="base">
          {receipt === undefined && <s-spinner accessibilityLabel="Loading your latest in-store purchase" />}
          {receipt === 'error' && <s-text color="subdued">We couldn't load your in-store purchases right now.</s-text>}
          {receipt === null && <s-text color="subdued">No in-store purchases yet.</s-text>}
          {receipt && receipt !== 'error' && <ReceiptCard receipt={receipt} />}
          <s-link href="extension:store-purchases/">View all purchases</s-link>
        </s-stack>
      </s-section>
    </s-grid>
  );
}

function OrderCard({order}) {
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
          {n} {n === 1 ? 'item' : 'items'} · {money(order.totalPrice.amount)}
        </s-text>
        <s-text color="subdued">
          Placed {formatDate(order.processedAt)}
          {order.cancelledAt ? ` · Canceled ${formatDate(order.cancelledAt)}` : ''}
        </s-text>
        <s-link href={orderUrl(order)}>View order</s-link>
      </s-stack>
    </s-grid>
  );
}

function ReceiptCard({receipt}) {
  const products = receipt.lines.filter((l) => l.type !== 'loyalty_redemption');
  const refunded = receipt.status === 'refunded';
  return (
    <s-grid gridTemplateColumns="auto 1fr" gap="base" alignItems="center">
      <s-icon type="store" />
      <s-stack gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text type="strong">{receipt.store || 'Carbon store'}</s-text>
          {refunded && <s-badge tone="neutral">Refunded</s-badge>}
        </s-stack>
        <s-text>
          {products[0]?.description ?? 'In-store purchase'}
          {products.length > 1 ? ` + ${products.length - 1} more` : ''} · {money(receipt.total)}
        </s-text>
        <s-text color="subdued">
          Purchased {formatDate(receipt.placed_at)} · Receipt {receipt.number}
        </s-text>
      </s-stack>
    </s-grid>
  );
}

function ThankYouCodes({codes}) {
  return (
    <s-section heading="Your thank-you code">
      <s-stack gap="base">
        {codes.map((c) => (
          <s-stack key={c.code} gap="small-200">
            <s-text type="strong">{c.percent_off}% off your next order</s-text>
            <s-text color="subdued">
              Thank you for order {c.order_name} · one use · valid until {formatDate(c.ends_at)}
            </s-text>
            <CodeRow code={c.code} />
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}

function CodeRow({code}) {
  const id = `copy-${code}`;
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-text type="strong">{code}</s-text>
      <s-clipboard-item id={id} text={code} />
      <s-button variant="secondary" commandFor={id}>
        Copy code
      </s-button>
    </s-stack>
  );
}
