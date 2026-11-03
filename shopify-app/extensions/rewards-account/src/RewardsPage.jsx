import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {cancelCode, getSummary, reasonLabel, redeem, redeemOptions} from './api.js';
import {
  firstImage,
  formatDate,
  getOnlineOrders,
  getOrderPoints,
  getStorePurchases,
  itemCount,
  mergePurchases,
  money,
  orderStatus,
  orderUrl,
} from './purchases.js';

// Carbon Member Club — Rewards (approved layouts 2026-11-03). Shopify draws the
// header and account menu; this page is the content area.
//  - Desktop: balance + redeem and the tier panel on top, referral and points
//    activity below, then the latest online order and in-store receipt.
//  - Phone (owner's phone mockup): balance, redeem buttons side by side, tier
//    card, points activity, refer a friend, then online and in-store purchases
//    as one list with the points each earned.
// The two layouts are switched by container width (CSS visibility, not code).
// Every figure comes from Carbon Rewards (rewards.shopcarbon.com) or Shopify;
// sample data only appears in the checkout & accounts editor preview.

export default async () => {
  render(<RewardsPage />, document.body);
};

const WIDE = '@container (inline-size > 700px)';
const DESKTOP_ONLY = `${WIDE} auto, none`;
const PHONE_ONLY = `${WIDE} none, auto`;
const TWO_COLUMNS = `${WIDE} 3fr 2fr, 1fr`;
const HALVES = `${WIDE} 1fr 1fr, 1fr`;
const ACTIVITY_SHOWN = 5;
const PHONE_ACTIVITY_SHOWN = 3;
const PHONE_PURCHASES_SHOWN = 3;

function RewardsPage() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(0);
  const [issued, setIssued] = useState(null);
  const [cancelling, setCancelling] = useState('');
  const [orders, setOrders] = useState(undefined); // undefined = loading, 'error', or a list
  const [store, setStore] = useState(undefined);

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
    getOnlineOrders(PHONE_PURCHASES_SHOWN)
      .then((list) => Promise.all(list.map(async (o) => ({...o, points: await getOrderPoints(o)}))))
      .then(setOrders)
      .catch(() => setOrders('error'));
    getStorePurchases()
      .then(setStore)
      .catch(() => setStore('error'));
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

  const redeemProps = {summary, busy, cancelling, onRedeem, onCancel};
  const purchases = {orders, store};

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
          <s-box display={DESKTOP_ONLY}>
            <s-stack gap="large">
              <s-grid gridTemplateColumns={TWO_COLUMNS} gap="large">
                <s-stack gap="large">
                  <Balance summary={summary} />
                  <Redeem {...redeemProps} idPrefix="d" />
                </s-stack>
                <Tier tier={summary.tier} />
              </s-grid>
              <s-grid gridTemplateColumns={TWO_COLUMNS} gap="large">
                {summary.referral ? <Referral referral={summary.referral} /> : <s-box />}
                <Activity activity={summary.activity ?? []} />
              </s-grid>
              <RecentPurchases {...purchases} />
            </s-stack>
          </s-box>

          <s-box display={PHONE_ONLY}>
            <s-stack gap="large">
              <PhoneBalance summary={summary} />
              <PhoneRedeem {...redeemProps} />
              <PhoneTier tier={summary.tier} />
              <PhoneActivity activity={summary.activity ?? []} />
              {summary.referral && <PhoneReferral referral={summary.referral} />}
              <PhonePurchases {...purchases} />
            </s-stack>
          </s-box>
        </s-query-container>
      )}
    </s-page>
  );
}

/* ---------------------------------- Desktop --------------------------------- */

function Balance({summary}) {
  const rules = summary.rules;
  const step = rules?.redeem_increment_points ?? 100;
  const stepDollars = step / (rules?.redeem_points_per_dollar ?? 10);
  return (
    <s-stack gap="small-200">
      <s-paragraph>
        Earn {rules?.earn_rate_per_dollar ?? 1} point for every $1 and turn {step} points into ${stepDollars} off.
      </s-paragraph>
      <s-heading>{summary.balance.toLocaleString()} points</s-heading>
      <s-text color="subdued">{balanceLine(summary)}</s-text>
    </s-stack>
  );
}

function Redeem({summary, busy, cancelling, onRedeem, onCancel, idPrefix}) {
  const rules = summary.rules;
  const options = redeemOptions(summary);
  if (summary.codes?.length > 0) {
    return <ActiveCodes codes={summary.codes} cancelling={cancelling} onCancel={onCancel} idPrefix={idPrefix} />;
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
  return (
    <s-section heading={`${tier.name} Tier`}>
      <s-stack gap="base">
        <s-text color="subdued">Current tier · {tier.multiplier}× points</s-text>
        {tier.next ? (
          <s-stack gap="small-200">
            <s-text>{progressLabel(tier)}</s-text>
            <TierBar tier={tier} />
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

function Referral({referral}) {
  const [copy, setCopy] = useState('');
  return (
    <s-section heading={`Refer a friend. Earn ${referral.you_get} points.`}>
      <s-stack gap="base">
        <s-paragraph>{referralTerms(referral)}</s-paragraph>
        <s-text type="strong">{referral.url}</s-text>
        <s-clipboard-item id="copy-referral-d" text={referral.url} onCopy={() => setCopy('ok')} onCopyError={() => setCopy('error')} />
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-button variant="secondary" commandFor="copy-referral-d">
            Copy referral link
          </s-button>
          <CopyStatus state={copy} />
        </s-stack>
      </s-stack>
    </s-section>
  );
}

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
            <ActivityRow key={i} a={a} unit="pts" tone="success" />
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

function RecentPurchases({orders, store}) {
  const order = Array.isArray(orders) ? orders[0] ?? null : orders;
  const receipt = Array.isArray(store) ? store[0] ?? null : store;
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

/* ----------------------------------- Phone ---------------------------------- */

function PhoneBalance({summary}) {
  return (
    <s-stack gap="small-200">
      <s-heading>{summary.balance.toLocaleString()} points</s-heading>
      <s-text>{balanceLine(summary)}</s-text>
    </s-stack>
  );
}

function PhoneRedeem({summary, busy, cancelling, onRedeem, onCancel}) {
  const rules = summary.rules;
  const options = redeemOptions(summary);
  if (summary.codes?.length > 0) {
    return <ActiveCodes codes={summary.codes} cancelling={cancelling} onCancel={onCancel} idPrefix="m" />;
  }
  if (!rules?.live || options.length === 0) return null;
  return (
    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
      {options.map((o) => (
        <s-button
          key={o.points}
          variant="primary"
          inlineSize="fill"
          loading={busy === o.points}
          disabled={busy !== 0 && busy !== o.points}
          onClick={() => onRedeem(o.points)}
          accessibilityLabel={`Redeem $${o.dollars} off for ${o.points} points`}
        >
          ${o.dollars} off / {o.points} points
        </s-button>
      ))}
    </s-grid>
  );
}

function PhoneTier({tier}) {
  if (!tier) return null;
  return (
    <s-box border="base" borderRadius="large" padding="base" background="base">
      <s-stack gap="small-200">
        <s-heading>{tier.name} Tier</s-heading>
        {tier.next ? (
          <>
            <s-text>
              {toNextLabel(tier)} to reach {tier.next.name}
            </s-text>
            <TierBar tier={tier} />
            <s-grid gridTemplateColumns="1fr auto" gap="base">
              <s-text color="subdued">{progressShort(tier)}</s-text>
              <s-text color="subdued">
                {targetShort(tier)} to {tier.next.name}
              </s-text>
            </s-grid>
          </>
        ) : (
          <s-text>You're at our top tier — thank you!</s-text>
        )}
      </s-stack>
    </s-box>
  );
}

function PhoneActivity({activity}) {
  const [all, setAll] = useState(false);
  const rows = all ? activity : activity.slice(0, PHONE_ACTIVITY_SHOWN);
  return (
    <s-box border="base" borderRadius="large" padding="base" background="base">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-heading>Points activity</s-heading>
          {activity.length > PHONE_ACTIVITY_SHOWN && (
            <s-link onClick={() => setAll(!all)}>{all ? 'Show less' : 'View all'}</s-link>
          )}
        </s-grid>
        {activity.length === 0 ? (
          <s-text color="subdued">No points activity yet.</s-text>
        ) : (
          rows.map((a, i) => (
            <s-stack key={i} gap="base">
              {i > 0 && <s-divider />}
              <ActivityRow a={a} unit="points" tone="info" />
            </s-stack>
          ))
        )}
      </s-stack>
    </s-box>
  );
}

function PhoneReferral({referral}) {
  const [copy, setCopy] = useState('');
  return (
    <s-box border="base" borderRadius="large" padding="base" background="subdued">
      <s-grid gridTemplateColumns="auto 1fr" gap="base">
        <s-icon type="team" tone="info" />
        <s-stack gap="small-200">
          <s-heading>Refer a friend</s-heading>
          <s-text>
            Your friend earns {referral.friend_gets} points, and you earn {referral.you_get} points after their first $
            {referral.min_purchase}+ purchase.
          </s-text>
          <s-clipboard-item id="copy-referral-m" text={referral.url} onCopy={() => setCopy('ok')} onCopyError={() => setCopy('error')} />
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button variant="primary" commandFor="copy-referral-m" accessibilityLabel="Copy your referral link">
              Refer a friend
            </s-button>
            <CopyStatus state={copy} />
          </s-stack>
          {copy === 'error' && <s-text type="strong">{referral.url}</s-text>}
        </s-stack>
      </s-grid>
    </s-box>
  );
}

function PhonePurchases({orders, store}) {
  const loading = orders === undefined || store === undefined;
  const rows = mergePurchases(orders, store).slice(0, PHONE_PURCHASES_SHOWN);
  return (
    <s-box border="base" borderRadius="large" padding="base" background="base">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-heading>Recent purchases</s-heading>
          <s-link href="extension:store-purchases/">View all</s-link>
        </s-grid>
        {loading && rows.length === 0 && <s-spinner accessibilityLabel="Loading your purchases" />}
        {orders === 'error' && <s-text color="subdued">Online orders couldn't load right now.</s-text>}
        {store === 'error' && <s-text color="subdued">In-store purchases couldn't load right now.</s-text>}
        {!loading && rows.length === 0 && orders !== 'error' && store !== 'error' && (
          <s-text color="subdued">No purchases yet.</s-text>
        )}
        {rows.map((p, i) => (
          <s-stack key={p.key} gap="base">
            {i > 0 && <s-divider />}
            <s-clickable href={p.href} accessibilityLabel={`${p.title}, ${p.where}, ${formatDate(p.at)}`}>
              <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
                {p.image ? (
                  <s-product-thumbnail src={p.image.url} alt={p.image.altText || ''} />
                ) : (
                  <s-icon type={p.where === 'Online' ? 'order' : 'store'} />
                )}
                <s-stack gap="none">
                  <s-text type="strong">{p.title}</s-text>
                  <s-text color="subdued">
                    {p.where} · {formatDate(p.at)}
                  </s-text>
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text>{money(p.total)}</s-text>
                    {p.status && <s-badge tone={p.status.tone}>{p.status.label}</s-badge>}
                  </s-stack>
                </s-stack>
                {p.points ? <s-text type="strong" tone="info">+{p.points} points</s-text> : <s-box />}
              </s-grid>
            </s-clickable>
          </s-stack>
        ))}
      </s-stack>
    </s-box>
  );
}

/* ---------------------------------- Shared ---------------------------------- */

function balanceLine(summary) {
  const rules = summary.rules;
  const options = redeemOptions(summary);
  const step = rules?.redeem_increment_points ?? 100;
  const stepDollars = step / (rules?.redeem_points_per_dollar ?? 10);
  return options.length
    ? `Up to $${options[options.length - 1].dollars} off your next purchase`
    : `${Math.max(1, step - summary.balance)} more points to unlock $${stepDollars} off`;
}

function ActiveCodes({codes, cancelling, onCancel, idPrefix}) {
  return (
    <s-section heading="Your active code">
      <s-stack gap="base">
        {codes.map((c) => (
          <s-stack key={c.code} gap="small-200">
            <s-text type="strong">${c.dollars} off your items</s-text>
            <s-text color="subdued">
              For items totaling ${c.min_subtotal} or more · shipping not included · expires {formatDate(c.expires_at)}
            </s-text>
            <CodeRow code={c.code} idPrefix={idPrefix} />
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

function TierBar({tier}) {
  const progress = Number(tier.progress);
  const target = progress + Number(tier.next?.needed);
  // Only when the server gives a usable basis.
  if (!tier.next || !(target > 0) || !Number.isFinite(progress) || progress < 0) return null;
  return <s-progress value={Math.min(progress, target)} max={target} accessibilityLabel={`Progress to ${tier.next.name} tier`} />;
}

function target(tier) {
  return Number(tier.progress) + Number(tier.next.needed);
}

// "202 / 500 points to Silver", "$120 / $500 spent toward Silver", "3 / 5 purchases toward Silver".
function progressLabel(tier) {
  const p = Math.floor(Number(tier.progress));
  const t = Math.ceil(target(tier));
  if (tier.metric === 'points') return `${p.toLocaleString()} / ${t.toLocaleString()} points to ${tier.next.name}`;
  if (tier.metric === 'visits') return `${p} / ${t} purchases toward ${tier.next.name}`;
  return `$${p.toLocaleString()} / $${t.toLocaleString()} spent toward ${tier.next.name}`;
}

// "Spend $410 more" / "Earn 298 more points" / "2 more purchases".
function toNextLabel(tier) {
  const n = Math.ceil(Number(tier.next.needed));
  if (tier.metric === 'points') return `Earn ${n.toLocaleString()} more points`;
  if (tier.metric === 'visits') return `Make ${n} more ${n === 1 ? 'purchase' : 'purchases'}`;
  return `Spend $${n.toLocaleString()} more`;
}

// Under the phone tier bar: "$90 spent" … "$500 to Silver".
function progressShort(tier) {
  const p = Math.floor(Number(tier.progress));
  if (tier.metric === 'points') return `${p.toLocaleString()} points`;
  if (tier.metric === 'visits') return `${p} ${p === 1 ? 'purchase' : 'purchases'}`;
  return `$${p.toLocaleString()} spent`;
}

function targetShort(tier) {
  const t = Math.ceil(target(tier));
  if (tier.metric === 'points') return `${t.toLocaleString()} points`;
  if (tier.metric === 'visits') return `${t} purchases`;
  return `$${t.toLocaleString()}`;
}

function referralTerms(referral) {
  return `Share your link. When a friend makes their first purchase of $${referral.min_purchase}+, they get ${referral.friend_gets} points and you get ${referral.you_get} points.`;
}

function CopyStatus({state}) {
  if (state === 'ok') return <s-text tone="success">Link copied</s-text>;
  if (state === 'error') return <s-text tone="critical">Couldn't copy — select the link instead</s-text>;
  return null;
}

const ACTIVITY_ICONS = {
  sale: 'bag',
  refund: 'reset',
  redemption: 'discount-code',
  referral_bonus: 'person-add',
  signup_bonus: 'gift',
  birthday_bonus: 'gift',
};

function activityLabel(a) {
  if (a.source === 'system' && a.reason === 'adjustment') return 'Code cancelled or expired — points returned';
  const where = a.source === 'shopify' ? 'Online' : a.source === 'pos' ? 'In-store' : '';
  if ((a.reason === 'sale' || a.reason === 'refund') && where) return `${reasonLabel(a.reason)} (${where})`;
  return reasonLabel(a.reason);
}

function ActivityRow({a, unit, tone}) {
  return (
    <s-grid gridTemplateColumns="auto 1fr auto" gap="base" alignItems="center">
      <s-icon type={ACTIVITY_ICONS[a.reason] ?? 'adjust'} />
      <s-stack gap="none">
        <s-text>{activityLabel(a)}</s-text>
        <s-text color="subdued">{formatDate(a.created_at)}</s-text>
      </s-stack>
      <s-text type="strong" tone={a.delta_points < 0 ? 'neutral' : tone}>
        {a.delta_points > 0 ? '+' : ''}
        {a.delta_points} {unit}
      </s-text>
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
            <CodeRow code={c.code} idPrefix="t" />
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}

function CodeRow({code, idPrefix}) {
  const id = `copy-${idPrefix}-${code}`;
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
