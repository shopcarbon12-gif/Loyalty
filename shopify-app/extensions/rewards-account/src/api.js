// Calls Carbon Rewards (rewards.shopcarbon.com) with the customer-account
// session token; the backend verifies it against the Carbon_Studio secret.
const BASE = 'https://rewards.shopcarbon.com';

async function call(path, init = {}) {
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.message || 'Something went wrong — please try again.'), {
      code: body.error,
    });
  }
  return body;
}

// The checkout & accounts editor previews as a fake customer, so Shopify's
// session token carries no customer id and the backend rightly refuses it.
// Show labelled sample data there instead so the layout can be placed.
export const inEditor = () => Boolean(shopify.extension.editor);

const SAMPLE = {
  linked: true,
  preview: true,
  first_name: 'Preview',
  balance: 250,
  activity: [
    {delta_points: 120, reason: 'sale', source: 'shopify', created_at: new Date().toISOString()},
    {delta_points: 25, reason: 'signup_bonus', source: 'system', created_at: new Date().toISOString()},
  ],
  codes: [],
  thank_you_codes: [
    {code: 'CARBON15-SAMPLE', percent_off: 15, ends_at: new Date(Date.now() + 40 * 86400000).toISOString(), order_name: '#1000'},
  ],
  tier: {
    code: 'bronze',
    name: 'Bronze',
    multiplier: 1,
    perks: ['Welcome bonus', 'Birthday gift'],
    metric: 'amount',
    progress: 120,
    next: {name: 'Silver', needed: 380, multiplier: 1.25},
  },
  referral: {
    code: 'CARBON-PREVIEW-000000',
    url: 'https://shopcarbon.com/?ref=CARBON-PREVIEW-000000',
    you_get: 200,
    friend_gets: 100,
    min_purchase: 60,
  },
  rules: {
    live: true,
    min_redeem_points: 100,
    redeem_increment_points: 100,
    redeem_points_per_dollar: 10,
    earn_rate_per_dollar: 1,
    max_redeem_pct_of_order: 50,
    max_redeem_dollars_per_order: 30,
  },
};

export const getSummary = () => (inEditor() ? Promise.resolve(SAMPLE) : call('/api/account/summary'));

export const redeem = (points) =>
  inEditor()
    ? Promise.reject(new Error('Redeeming is disabled in the editor preview.'))
    : call('/api/account/redeem', {method: 'POST', body: JSON.stringify({points})});

export const cancelCode = (code) =>
  inEditor()
    ? Promise.reject(new Error('Cancelling is disabled in the editor preview.'))
    : call('/api/account/cancel', {method: 'POST', body: JSON.stringify({code})});

// $10 steps up to the per-purchase cap, limited by balance.
export function redeemOptions(summary) {
  const r = summary.rules;
  const step = r.redeem_increment_points;
  const maxByCap = Math.floor((r.max_redeem_dollars_per_order * r.redeem_points_per_dollar) / step) * step;
  const maxByBalance = Math.floor(summary.balance / step) * step;
  const max = Math.min(maxByCap, maxByBalance);
  const out = [];
  for (let p = Math.max(step, r.min_redeem_points); p <= max; p += step) {
    out.push({points: p, dollars: p / r.redeem_points_per_dollar});
  }
  return out;
}

export function redeemableDollars(summary) {
  const opts = redeemOptions(summary);
  return opts.length ? opts[opts.length - 1].dollars : 0;
}

const REASONS = {
  sale: 'Purchase',
  redemption: 'Redeemed',
  refund: 'Refund',
  signup_bonus: 'Welcome bonus',
  birthday_bonus: 'Birthday bonus',
  referral_bonus: 'Referral bonus',
  manual: 'Adjustment',
  adjustment: 'Adjustment',
  migration: 'Points transferred',
};

export const reasonLabel = (reason) => REASONS[reason] || 'Activity';
