# Live theme snippets (shopcarbon.com)

Copies of what's uploaded to the published theme — edit here, then upload
with `themeFilesUpsert` (the theme itself isn't in git).

- `carbon-rewards-balance.liquid` — signed-in points on /pages/rewards
  (rendered from `templates/page.rewards.context.us.json`, which also swaps
  to the `rewards-member-*` banner for members). Button opens the
  customer-account Rewards page.
- `carbon-rewards-cart.liquid` — "Use your points" box, rendered in
  `snippets/cart-drawer.liquid` and `sections/main-cart.liquid` just above
  the terms checkbox. Calls `/apps/loyalty/*` (Carbon_Studio app proxy) and
  applies the code to the cart, then fires the theme's `cart:refresh`.
