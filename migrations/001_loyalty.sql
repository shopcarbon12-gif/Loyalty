-- 001_loyalty.sql
-- Carbon Loyalty initial schema. Runs in the shared Postgres (same DB as
-- Carbon-POS and CarbonWMS). All loyalty_* tables are owned by the
-- Carbon-Loyalty service; columns added to existing tables are pos_* /
-- shopify_tokens.
--
-- Idempotent: safe to re-run. Migration runner records the file's hash
-- so a single successful run keeps it from re-executing.

-- ---------------------------------------------------------------------------
-- loyalty_settings — 1-row config table. Tunable from the admin UI.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Earn
  earn_rate_per_dollar         NUMERIC(6,4)  NOT NULL DEFAULT 1.0,    -- 1 pt per $1
  exclude_tax                  BOOLEAN       NOT NULL DEFAULT TRUE,
  exclude_gift_card_purchases  BOOLEAN       NOT NULL DEFAULT TRUE,
  -- Redeem
  redeem_points_per_dollar     INTEGER       NOT NULL DEFAULT 10,     -- 100 pts = $10
  min_redeem_points            INTEGER       NOT NULL DEFAULT 100,
  redeem_increment_points      INTEGER       NOT NULL DEFAULT 100,
  max_redeem_pct_of_order      INTEGER       NOT NULL DEFAULT 50,
  coupon_ttl_hours             INTEGER       NOT NULL DEFAULT 24,
  allow_stacking_with_codes    BOOLEAN       NOT NULL DEFAULT FALSE,
  -- Bonuses
  signup_bonus_points          INTEGER       NOT NULL DEFAULT 25,     -- matches Kangaroo today
  birthday_bonus_points        INTEGER       NOT NULL DEFAULT 200,    -- NEW
  referral_reward_points       INTEGER       NOT NULL DEFAULT 100,    -- matches Kangaroo
  -- Lifetime
  points_never_expire          BOOLEAN       NOT NULL DEFAULT TRUE,
  -- Shopify metafield
  metafield_namespace          TEXT          NOT NULL DEFAULT 'loyalty',
  metafield_key                TEXT          NOT NULL DEFAULT 'balance',
  -- Live switch
  live                         BOOLEAN       NOT NULL DEFAULT FALSE,  -- LOYALTY_LIVE flag
  updated_at                   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
INSERT INTO loyalty_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- loyalty_ledger — append-only, source of truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id              BIGSERIAL PRIMARY KEY,
  customer_id     INTEGER REFERENCES pos_customers(id) ON DELETE SET NULL,
  shopify_gid     TEXT,
  delta_points    INTEGER NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN
                    ('sale','redemption','refund','signup_bonus','birthday_bonus',
                     'referral_bonus','manual','adjustment','migration')),
  source          TEXT NOT NULL CHECK (source IN ('pos','shopify','admin','system')),
  source_ref      TEXT,
  amount_basis    NUMERIC(10,2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID,
  metafield_synced_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS loyalty_ledger_customer_idx
  ON loyalty_ledger (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loyalty_ledger_gid_idx
  ON loyalty_ledger (shopify_gid);
-- Idempotency: same (source, source_ref) pair never produces two rows. Webhook
-- replays + capture-route retries become harmless.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_ledger_source_ref_uq
  ON loyalty_ledger (source, source_ref) WHERE source_ref IS NOT NULL;

-- Convenience view: balance per customer.
CREATE OR REPLACE VIEW loyalty_balance AS
  SELECT customer_id,
         COALESCE(SUM(delta_points), 0)::int AS balance,
         MAX(created_at)                     AS last_event_at
    FROM loyalty_ledger
   GROUP BY customer_id;

-- ---------------------------------------------------------------------------
-- loyalty_idempotency — short-lived dedupe of API writes. POS supplies a
-- key per attempt; replays return the same response.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_idempotency (
  key             TEXT PRIMARY KEY,
  endpoint        TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  ledger_id       BIGINT REFERENCES loyalty_ledger(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_idempotency_created_idx
  ON loyalty_idempotency (created_at);

-- ---------------------------------------------------------------------------
-- loyalty_tiers — populated empty in B1. B6 fills with the 4-tier ladder.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  code             TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  qualifying_points INTEGER NOT NULL,
  earn_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  perks            JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- loyalty_referrals — referrer code generation + attribution log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_referrals (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,
  referrer_customer_id INTEGER NOT NULL REFERENCES pos_customers(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS loyalty_referral_redemptions (
  id              BIGSERIAL PRIMARY KEY,
  referral_id     BIGINT NOT NULL REFERENCES loyalty_referrals(id) ON DELETE CASCADE,
  referee_customer_id INTEGER REFERENCES pos_customers(id) ON DELETE SET NULL,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  shopify_order_gid TEXT,
  pos_sale_id     INTEGER
);

-- ---------------------------------------------------------------------------
-- loyalty_comms_log — every transactional email/SMS we send.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loyalty_comms_log (
  id              BIGSERIAL PRIMARY KEY,
  customer_id     INTEGER REFERENCES pos_customers(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email','sms')),
  template        TEXT NOT NULL,
  to_address      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent','failed','bounced','queued')),
  related_ledger_id BIGINT REFERENCES loyalty_ledger(id) ON DELETE SET NULL,
  provider_id     TEXT,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_comms_log_customer_idx
  ON loyalty_comms_log (customer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- pos_customers extensions — Shopify GID linkage.
-- ---------------------------------------------------------------------------
ALTER TABLE pos_customers
  ADD COLUMN IF NOT EXISTS shopify_customer_gid TEXT,
  ADD COLUMN IF NOT EXISTS shopify_linked_at    TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS pos_customers_shopify_gid_idx
  ON pos_customers (shopify_customer_gid);
