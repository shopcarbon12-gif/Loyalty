-- 006_metafield_sync.sql
-- Tracks the last balance pushed to each linked member's Shopify customer
-- metafield (loyalty_settings.metafield_namespace / metafield_key). The
-- storefront theme reads that metafield to show points, so the sync job
-- (POST /api/cron/sync-metafields) pushes only rows whose ledger balance
-- differs from what Shopify already has.

CREATE TABLE IF NOT EXISTS loyalty_metafield_sync (
  customer_id     INT PRIMARY KEY,
  shopify_gid     TEXT NOT NULL,
  pushed_balance  INT NOT NULL,
  pushed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT
);
