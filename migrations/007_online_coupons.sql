-- 007_online_coupons.sql
-- Discount codes issued when a member redeems points from the Shopify
-- customer account (Rewards page extension). Points are debited at issue
-- time (ledger source='shopify', source_ref='coupon:<code>'); a code that
-- expires unused is credited back by /api/cron/expire-coupons
-- (source='system', source_ref='coupon-expired:<code>').

CREATE TABLE IF NOT EXISTS loyalty_coupons (
  id                  BIGSERIAL PRIMARY KEY,
  customer_id         INT NOT NULL REFERENCES pos_customers(id),
  shopify_gid         TEXT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  discount_gid        TEXT,
  points              INT NOT NULL,
  dollars             NUMERIC(10, 2) NOT NULL,
  min_subtotal        NUMERIC(10, 2),
  ledger_id           BIGINT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  used_order_gid      TEXT,
  refunded_ledger_id  BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loyalty_coupons_customer_idx ON loyalty_coupons (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loyalty_coupons_open_idx
  ON loyalty_coupons (expires_at) WHERE used_at IS NULL AND refunded_ledger_id IS NULL;
