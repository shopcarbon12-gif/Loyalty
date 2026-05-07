-- 002_referral_split_and_tiers.sql
-- Folds in corrections from loyalty-kangaroo-reference.md:
--   1. Referral pays BOTH sides (we previously only credited the referrer).
--   2. Referrals require a minimum qualifying purchase (Kangaroo today: $50).
--   3. Tier batch runs daily at 10:00 a.m. EST — store the hour as config so
--      ops can tune it without a deploy.
--   4. Seed the four-tier ladder (Bronze / Silver / Gold / VIP) so the
--      admin tier-config page and the WMS surface read from real rows.

-- New settings columns -----------------------------------------------------
ALTER TABLE loyalty_settings
  ADD COLUMN IF NOT EXISTS referee_earns_points    INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS referral_min_purchase   NUMERIC(10,2) NOT NULL DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS tier_batch_hour_est     INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS tier_qualifying_metric  TEXT    NOT NULL DEFAULT 'amount'
                                                   CHECK (tier_qualifying_metric IN ('amount','points','visits'));

-- Seed the tier ladder if empty --------------------------------------------
INSERT INTO loyalty_tiers (code, name, qualifying_points, earn_multiplier, perks, sort_order)
  VALUES
    ('bronze', 'Bronze',     0,    1.00, '["Welcome bonus","Birthday gift"]'::jsonb, 1),
    ('silver', 'Silver',   500,    1.25, '["1.25x points","Free shipping"]'::jsonb, 2),
    ('gold',   'Gold',    1500,    1.50, '["1.5x points","Early access","Priority support"]'::jsonb, 3),
    ('vip',    'VIP',     5000,    2.00, '["2x points","Concierge","Exclusive drops"]'::jsonb, 4)
  ON CONFLICT (code) DO NOTHING;

-- Track which qualifying purchase fired the referral payout, so the unique
-- index on loyalty_ledger guarantees we never double-credit either side.
ALTER TABLE loyalty_referral_redemptions
  ADD COLUMN IF NOT EXISTS qualifying_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS referrer_ledger_id BIGINT REFERENCES loyalty_ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referee_ledger_id  BIGINT REFERENCES loyalty_ledger(id) ON DELETE SET NULL;

-- A referee can only convert a single referral. Enforce at the column level
-- so we never have two referrers claiming the same person.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_referral_redemptions_referee_uq
  ON loyalty_referral_redemptions (referee_customer_id)
  WHERE referee_customer_id IS NOT NULL;
