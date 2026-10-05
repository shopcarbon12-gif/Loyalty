import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {cancelCode, getSummary, reasonLabel, redeem, redeemOptions} from './api.js';

export default async () => {
  render(<RewardsPage />, document.body);
};

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
      <s-page heading="Carbon Rewards">
        <s-section>
          <s-spinner accessibilityLabel="Loading your rewards" />
        </s-section>
      </s-page>
    );
  }

  const options = summary ? redeemOptions(summary) : [];
  const rules = summary?.rules;
  const step = rules?.redeem_increment_points ?? 100;
  const hasActiveCode = summary?.codes?.length > 0;

  return (
    <s-page heading="Carbon Rewards" subheading="1 point for every $1 · every 100 points = $10 off">
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
          <s-stack gap="base">
            <s-paragraph>
              Enter it at checkout before {formatDate(issued.expires_at)} on items totaling $
              {issued.min_subtotal} or more. Changed your mind? Cancel it below to get your points back.
            </s-paragraph>
          </s-stack>
        </s-banner>
      )}

      {summary && (
        <s-section heading="Your points">
          <s-stack gap="small-200">
            <s-heading>{summary.balance.toLocaleString()} points</s-heading>
            <s-text color="subdued">
              {options.length
                ? `You can take up to $${options[options.length - 1].dollars} off your next purchase.`
                : `${Math.max(1, step - summary.balance)} more points to unlock $10 off.`}
            </s-text>
          </s-stack>
        </s-section>
      )}

      {summary?.tier && (
        <s-section heading="Your tier">
          <s-stack gap="small-200">
            <s-text type="strong">
              {summary.tier.name} · {summary.tier.multiplier}× points
            </s-text>
            {summary.tier.perks?.length > 0 && <s-text color="subdued">{summary.tier.perks.join(' · ')}</s-text>}
            <s-text color="subdued">
              {summary.tier.next
                ? `${toNextLabel(summary.tier)} to reach ${summary.tier.next.name} (${summary.tier.next.multiplier}× points).`
                : "You're at our top tier — thank you!"}
            </s-text>
          </s-stack>
        </s-section>
      )}

      {summary && rules?.live && options.length > 0 && !hasActiveCode && (
        <s-section heading="Redeem points">
          <s-stack gap="base">
            <s-paragraph>
              Pick a reward to get a one-time code for checkout. You can use up to $
              {rules.max_redeem_dollars_per_order} off per purchase.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              {options.map((o) => (
                <s-button
                  key={o.points}
                  variant={o.points === options[options.length - 1].points ? 'primary' : 'secondary'}
                  loading={busy === o.points}
                  disabled={busy !== 0 && busy !== o.points}
                  onClick={() => onRedeem(o.points)}
                >
                  ${o.dollars} off · {o.points} pts
                </s-button>
              ))}
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {hasActiveCode && (
        <s-section heading="Your active code">
          <s-stack gap="base">
            {summary.codes.map((c) => (
              <s-stack key={c.code} gap="small-200">
                <s-text type="strong">${c.dollars} off your items</s-text>
                <s-text color="subdued">
                  For items totaling ${c.min_subtotal} or more · shipping not included · expires{' '}
                  {formatDate(c.expires_at)}
                </s-text>
                <CodeRow code={c.code} />
                <s-stack direction="inline">
                  <s-button
                    variant="secondary"
                    tone="critical"
                    loading={cancelling === c.code}
                    onClick={() => onCancel(c.code)}
                  >
                    Cancel code &amp; return {c.points} points
                  </s-button>
                </s-stack>
              </s-stack>
            ))}
            <s-text color="subdued">
              One code at a time. Cancel this one to choose a different reward — unused codes also
              return their points automatically when they expire.
            </s-text>
          </s-stack>
        </s-section>
      )}

      {summary?.referral && (
        <s-section heading="Refer a friend">
          <s-stack gap="base">
            <s-paragraph>
              Share your link. When a friend makes their first purchase of ${summary.referral.min_purchase}+, they get{' '}
              {summary.referral.friend_gets} points and you get {summary.referral.you_get} points.
            </s-paragraph>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-text type="strong">{summary.referral.url}</s-text>
              <s-clipboard-item id="copy-referral" text={summary.referral.url} />
              <s-button variant="secondary" commandFor="copy-referral">
                Copy link
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {summary?.activity?.length > 0 && (
        <s-section heading="Recent activity">
          <s-stack gap="small-300">
            {summary.activity.map((a, i) => (
              <s-grid key={i} gridTemplateColumns="1fr auto" gap="base">
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
                  {a.delta_points}
                </s-text>
              </s-grid>
            ))}
          </s-stack>
        </s-section>
      )}

      {summary && !summary.linked && (
        <s-section>
          <s-paragraph>
            Your points will appear here after your first purchase online or in store.
          </s-paragraph>
        </s-section>
      )}
    </s-page>
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

// "Spend $380 more" / "Earn 380 more points" / "2 more purchases".
function toNextLabel(tier) {
  const n = Math.ceil(tier.next.needed);
  if (tier.metric === 'points') return `Earn ${n.toLocaleString()} more points`;
  if (tier.metric === 'visits') return `${n} more ${n === 1 ? 'purchase' : 'purchases'}`;
  return `Spend $${n.toLocaleString()} more`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'});
}
