/*
 * Carbon Rewards — shared storefront helpers for the cart box
 * (snippets/carbon-rewards-cart.liquid) and the floating widget
 * (snippets/carbon-rewards-widget.liquid).
 *
 * Talks to rewards.shopcarbon.com through the Carbon_Studio app proxy
 * (/apps/loyalty/*), which signs every request with the logged-in customer.
 * Reward codes are prefixed CR-; we only ever add/remove our own codes on the
 * cart and keep any others the customer entered.
 */
(() => {
  if (window.CarbonRewards) return;

  const money = (d) => '$' + (Number.isInteger(d) ? d : Number(d).toFixed(2));

  async function api(path, body) {
    const res = await fetch('/apps/loyalty/' + path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong — please try again.'), { code: data.error });
    return data;
  }

  const getCart = () => fetch('/cart.js').then((r) => r.json());
  const cartCodes = (cart) => (cart.discount_codes || []).map((c) => String(c.code).toUpperCase());
  const rewardCodeIn = (cart) => cartCodes(cart).find((c) => c.startsWith('CR-')) || '';

  /** Replace our reward code on the cart with `code` (or none); returns the new cart. */
  async function setRewardCode(cart, code) {
    const others = cartCodes(cart).filter((c) => !c.startsWith('CR-'));
    const want = code ? [...others, code.toUpperCase()] : others;
    const res = await fetch('/cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount: want.join(',') }),
    });
    const next = await res.json().catch(() => cart);
    document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
    document.dispatchEvent(new CustomEvent('carbon-rewards:changed'));
    return next;
  }

  /** Minimum items subtotal for a reward worth `dollars` (mirrors lib/coupons.ts). */
  const minFor = (rules, dollars) => Math.max(
    dollars,
    rules.max_redeem_pct_of_order > 0 && rules.max_redeem_pct_of_order < 100
      ? Math.ceil(dollars * 100 / rules.max_redeem_pct_of_order) : 0,
  );

  /** $10 steps up to the per-purchase cap, limited by balance; `ok` = cart big enough. */
  function options(summary, subtotal) {
    const r = summary.rules, step = r.redeem_increment_points;
    const max = Math.min(
      Math.floor(r.max_redeem_dollars_per_order * r.redeem_points_per_dollar / step) * step,
      Math.floor(summary.balance / step) * step,
    );
    const out = [];
    for (let p = Math.max(step, r.min_redeem_points); p <= max; p += step) {
      const dollars = p / r.redeem_points_per_dollar;
      out.push({ points: p, dollars, ok: subtotal >= minFor(r, dollars), min: minFor(r, dollars) });
    }
    return out;
  }

  window.CarbonRewards = { api, getCart, cartCodes, rewardCodeIn, setRewardCode, minFor, options, money };
})();
