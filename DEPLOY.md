# Carbon-Loyalty deploy — one-time setup

The repo is initialised locally and the first commit is in `main`. The
following needs your hands once because it touches DNS + a new GitHub
repo + a new Coolify app — none of which can be done from here without
your Cloudflare / GitHub / Coolify credentials.

Total time: ~15 minutes.

## 1. Create the GitHub repo

```sh
# From your laptop, where you already have GitHub auth working:
cd /home/carbondev/dev/Carbon-Loyalty
gh repo create shopcarbon12-gif/Carbon-Loyalty --private --source=. --remote=origin --push
```

Or via the web UI:
1. Create empty repo `shopcarbon12-gif/Carbon-Loyalty`, private.
2. `git -C /home/carbondev/dev/Carbon-Loyalty remote add origin git@github.com:shopcarbon12-gif/Carbon-Loyalty.git`
3. `git -C /home/carbondev/dev/Carbon-Loyalty push -u origin main`

## 2. Add DNS for `rewards.shopcarbon.com`

Wherever shopcarbon.com's DNS is hosted (Cloudflare / Route 53 / etc):

  Type:  A
  Name:  loyalty
  Value: 178.156.136.112        (same IP as pos.shopcarbon.com)
  Proxy: off (or use Coolify's TLS, not Cloudflare's)

## 3. Generate the shared secrets

```sh
openssl rand -hex 32   # → LOYALTY_API_KEY  (paste into POS, Loyalty, WMS)
openssl rand -hex 32   # → LOYALTY_OUTBOX_DRAIN_KEY  (paste into POS only)
openssl rand -base64 32  # → NEXTAUTH_SECRET (Loyalty only)
```

## 4. Provision the Coolify application

In the Coolify UI on `178.156.136.112:8000`:

1. New Application → from **GitHub** → repo `shopcarbon12-gif/Carbon-Loyalty`, branch `main`.
2. **Build pack: Dockerfile** (we ship `Dockerfile` in the repo root).
3. **Project: CARBON-POS** (uuid `gog4ww04so4ogsg0wcgg8koc`) — same project as Carbon-POS so shared env/labels are easy.
4. **Environment: production** (uuid `fgggck4ssg40o004g0c0o088`).
5. **Domain**: `rewards.shopcarbon.com`.
6. **Port**: `5100` (in both `EXPOSE` and Coolify's port-exposes setting).
7. **Custom labels** (Traefik) — Coolify generates these from the port; if your build hits a 502 after first deploy, see `memory/project_pos_coolify_setup.md` — you may need to PATCH the application with the regenerated `custom_labels` after changing `ports_exposes`.
8. **Health check path**: `/admin` (returns 307 to `/admin` — pass code `200,301,302,307,308`).

## 5. Set environment variables in Coolify

```
DATABASE_URL=postgres://postgres:3H5ouoNVVMvUyFweIwpH50KiJwfkFLin6wJjyMg49RIEv6UTKJZqo1QFYSpez6g1@iogw84scwo0owsco8c8wg4s0:5432/postgres
LOYALTY_API_KEY=<from step 3>
SHOPIFY_API_SECRET=<Shopify app secret, from carbon-gen .env.coolify.local or the Partners dashboard>
SHOPIFY_API_VERSION=2025-01
NEXTAUTH_SECRET=<from step 3>
NEXTAUTH_URL=https://rewards.shopcarbon.com
RESEND_API_KEY=<same value as Carbon-POS>
LOYALTY_FROM_EMAIL=rewards@shopcarbon.com
PORT=5100
```

Click **Deploy**. The container's entrypoint runs the migrations
automatically before starting the Next server.

## 6. Update Carbon-POS env

Add to the `Carbon-pos` Coolify app (uuid `i4scskw00484ok4480k8s0oc`):

```
LOYALTY_API_BASE_URL=https://rewards.shopcarbon.com
LOYALTY_API_KEY=<same value as step 3>
LOYALTY_OUTBOX_DRAIN_KEY=<from step 3>
```

Restart `Carbon-pos` (no rebuild needed; just restart so the env reloads).

## 7. Update CarbonWMS env

Add to the WMS Coolify app (uuid `h8044k088gko8cw4wgwwwg40`):

```
LOYALTY_API_BASE_URL=https://rewards.shopcarbon.com
LOYALTY_API_KEY=<same value as step 3>
```

Restart WMS.

## 8. Schedule the outbox-drain cron

In Coolify, on `Carbon-pos`, add a scheduled task:

```
*/1 * * * *
curl -fsS -X POST -H "Authorization: Bearer $LOYALTY_OUTBOX_DRAIN_KEY" \
     https://pos.shopcarbon.com/api/pos/loyalty-outbox/drain >/dev/null 2>&1
```

Every 1 minute. Drains queued earn / redeem / refund calls to loyalty.

## 9. Update the Shopify app

In your Shopify Partners dashboard for the Carbon Loyalty app
(Carbon-Gen owns the install, but we need the routes pointed at
rewards.shopcarbon.com):

- **App URL**: `https://rewards.shopcarbon.com`
- **Allowed redirection URLs**: include
  `https://rewards.shopcarbon.com/api/auth/callback`
- **App proxy**:
  - sub-path prefix: `apps`
  - sub-path: `loyalty`
  - proxy URL: `https://rewards.shopcarbon.com/apps/loyalty`
- **Webhook subscriptions**:
  - `orders/create` → `https://rewards.shopcarbon.com/api/shopify/webhooks/orders-create`
  - `orders/cancelled` → `https://rewards.shopcarbon.com/api/shopify/webhooks/orders-cancelled`
  - `refunds/create` → `https://rewards.shopcarbon.com/api/shopify/webhooks/refunds-create`
  - API version: 2025-01

## 10. Flip the live switch when ready

`live = false` by default. Customers see no change, no points
accumulate, redemption is blocked. When you're ready to go live:

  https://rewards.shopcarbon.com/admin/settings → toggle "LOYALTY_LIVE" → save

That's the cutover moment. Kangaroo can be uninstalled the same hour.

## Verifying after deploy

```sh
# Health
curl -fsS -I https://rewards.shopcarbon.com/admin   # should be 200 or 307
curl -fsS https://rewards.shopcarbon.com/api/v1/customers/1/balance   # 401 (no bearer)

# Migration ran
docker run --rm -e PGPASSWORD='…' postgres:18 psql -h 178.156.136.112 -p 2040 -U postgres -d postgres \
  -c "SELECT count(*) FROM loyalty_settings;"   # 1
```
