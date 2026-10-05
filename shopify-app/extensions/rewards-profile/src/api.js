// Calls Carbon Rewards (rewards.shopcarbon.com) with the customer-account
// Shared with ../../rewards-account/src/api.js — keep the two copies in sync.
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

export const getSummary = () => call('/api/account/summary');

export const redeem = (points) =>
  call('/api/account/redeem', {method: 'POST', body: JSON.stringify({points})});

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
