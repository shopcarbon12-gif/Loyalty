# Carbon_Studio app — Carbon Rewards extensions

Linked to the live **Carbon_Studio** app (client id `4727a6133fedbfcf37e9df7fba5744de`).
`shopify.app.toml` is pulled from Shopify — re-run `npx shopify app config link
--client-id 4727a6133fedbfcf37e9df7fba5744de` before deploying so dashboard
changes (scopes, URLs) aren't overwritten.

- `extensions/rewards-account` — full **Rewards** page in customer accounts
  (account.shopcarbon.com): balance, redeem $10/$20/$30 for a one-time code,
  active codes, recent activity. Linked from the customer account menu.
- `extensions/rewards-profile` — balance card on the Profile page (placed in
  Settings → Customer accounts → Customize).

Both call `https://rewards.shopcarbon.com/api/account/*` with the session
token (see `lib/customer-session.ts`). `src/api.js` is duplicated in each
extension — keep the copies in sync.

```sh
nvm use 22            # CLI 4.x needs Node ≥ 22
npm install
npx shopify app deploy --allow-updates   # never --allow-deletes: other extensions live on this app
```
