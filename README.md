# Carbon Loyalty

Dedicated loyalty service. Replaces Kangaroo Rewards. Hosts the points
ledger, the back-office admin UI, the Shopify integration (webhooks +
app-proxy + Theme App Extension), and the transactional sender.

Lives at **`loyalty.shopcarbon.com`**. Talks to the same Postgres as
Carbon-POS and CarbonWMS.

## Run locally

```sh
nvm use 20
cp .env.example .env.local      # fill DATABASE_URL, LOYALTY_API_KEY,
                                # NEXTAUTH_SECRET, SHOPIFY_API_SECRET
npm install
npm run db:migrate              # applies migrations/*.sql
npm run dev                     # http://localhost:5100
```

## Deploy (Coolify, manual one-time setup)

1. New Coolify application, Dockerfile build, name `Carbon-Loyalty`.
2. Domain: `loyalty.shopcarbon.com` — point DNS A record at the same
   server IP as `pos.shopcarbon.com`. Coolify Traefik handles routing.
3. Environment variables:
   - `DATABASE_URL` — `postgres://postgres:…@iogw84scwo0owsco8c8wg4s0:5432/postgres`
     (internal Coolify hostname, same Postgres as POS and WMS)
   - `LOYALTY_API_KEY` — 64-char random hex; same value goes into
     Carbon-POS's env so the two services share auth.
   - `LOYALTY_OUTBOX_DRAIN_KEY` — 32-char random hex; goes into
     Carbon-POS env. The Coolify cron uses it to drain `pos_loyalty_outbox`.
   - `SHOPIFY_API_SECRET` — Shopify app secret (verifies webhooks +
     app-proxy signatures).
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`.
   - `NEXTAUTH_URL` — `https://loyalty.shopcarbon.com`.
   - `RESEND_API_KEY` — same as POS for transactional email.
4. Set `EXPOSE` / `PORT` to 5100 in Coolify's port settings; rewrite
   `custom_labels` so Traefik serves on 5100 (same gotcha as POS — see
   memory file).
5. Push and deploy. Migration runner runs automatically on container
   boot (`docker-entrypoint.sh`).

## Carbon-POS env additions

In Coolify's `Carbon-POS` app, add:

```
LOYALTY_API_BASE_URL=https://loyalty.shopcarbon.com
LOYALTY_API_KEY=<same value as Carbon-Loyalty>
LOYALTY_OUTBOX_DRAIN_KEY=<random hex>
```

Then add a Coolify cron schedule:

```
*/1 * * * *  curl -fsS -X POST -H "Authorization: Bearer $LOYALTY_OUTBOX_DRAIN_KEY" \
                 https://pos.shopcarbon.com/api/pos/loyalty-outbox/drain >/dev/null
```

(every 1 min — drains pending earn / redeem / refund calls to loyalty.)

## API surface

### v1 (server-to-server, `Authorization: Bearer LOYALTY_API_KEY`)

- `GET  /api/v1/customers/:id/balance`
- `POST /api/v1/earn`
- `POST /api/v1/redeem`
- `POST /api/v1/refund`
- `POST /api/v1/customers/link`
- `POST /api/admin/adjust`

### Shopify webhooks (HMAC verified)

- `POST /api/shopify/webhooks/orders-create`
- `POST /api/shopify/webhooks/orders-cancelled`
- `POST /api/shopify/webhooks/refunds-create`

### Storefront app proxy (signature verified)

- `GET /apps/loyalty/balance` — current customer balance + tier
- `GET /apps/loyalty/activity` — last 10 ledger entries

### Admin UI

- `/admin` — dashboard
- `/admin/settings` — program rules
- `/admin/ledger` — recent activity browser
