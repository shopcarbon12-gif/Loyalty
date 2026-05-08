-- 003_customer_provenance.sql
-- Adds the provenance columns to pos_customers so every member shows
-- WHO added them, WHEN, WHERE (physical store), and HOW (channel/source).
--
-- created_by_user_id (UUID) and pos_location_id (INT) already exist
-- on pos_customers — this migration only adds the two missing fields:
--   * created_at_geo  — free-text "city, state" for online signups
--                       (Shopify shipping). NULL for in-store events
--                       which already have a real location_id.
--   * created_via     — channel/source enum.
--
-- Existing rows (pre-migration) get created_via='legacy' so reports
-- can distinguish "we don't know" from "definitely added via X".
--
-- Customers are NOT scoped by location — these columns are pure data
-- attribution for analytics and audit. Every customer remains visible
-- to every location.

ALTER TABLE pos_customers
  ADD COLUMN IF NOT EXISTS created_at_geo TEXT,
  ADD COLUMN IF NOT EXISTS created_via    TEXT NOT NULL DEFAULT 'legacy'
                                          CHECK (created_via IN
                                            ('pos','shopify','wms_manual','wms_csv','admin','legacy'));

CREATE INDEX IF NOT EXISTS pos_customers_created_via_idx
  ON pos_customers (created_via, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_customers_created_loc_idx
  ON pos_customers (pos_location_id, created_at DESC)
  WHERE pos_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_customers_created_user_idx
  ON pos_customers (created_by_user_id, created_at DESC)
  WHERE created_by_user_id IS NOT NULL;
