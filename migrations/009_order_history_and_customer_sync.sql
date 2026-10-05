-- 009_order_history_and_customer_sync.sql
-- One customer, one history, across Shopify / Carbon-POS / CarbonWMS.
--
-- shopify_orders     — every online order, kept current by the orders/*
--                      webhooks (Carbon-Rewards) and linked to pos_customers.
-- customer_purchases — in-store (pos_sales) + online (shopify_orders) in one
--                      shape. POS, WMS and the customer-account page all read
--                      this view so their purchase histories can't drift.
-- customer_sync_outbox + trigger — any change to a member's name / email /
--                      phone made in POS or WMS is queued and pushed to
--                      Shopify by /api/cron/customer-sync. Changes that came
--                      FROM Shopify run with carbon.sync_origin = 'shopify'
--                      and are skipped, so updates never ping-pong.

CREATE TABLE IF NOT EXISTS shopify_orders (
  order_gid            TEXT PRIMARY KEY,           -- gid://shopify/Order/123
  order_name           TEXT NOT NULL,              -- #1076
  customer_id          INT REFERENCES pos_customers(id) ON DELETE SET NULL,
  shopify_customer_gid TEXT,
  email                TEXT,
  processed_at         TIMESTAMPTZ NOT NULL,
  currency             TEXT,
  subtotal             NUMERIC(12, 2),             -- after discounts, before shipping/tax
  total_discounts      NUMERIC(12, 2),
  total_shipping       NUMERIC(12, 2),
  total_tax            NUMERIC(12, 2),
  total                NUMERIC(12, 2),
  financial_status     TEXT,                       -- paid / refunded / partially_refunded ...
  fulfillment_status   TEXT,                       -- null / fulfilled / partial
  cancelled_at         TIMESTAMPTZ,
  discount_codes       TEXT[] NOT NULL DEFAULT '{}',
  line_items           JSONB NOT NULL DEFAULT '[]', -- [{title, variant_title, sku, quantity, price}]
  status_url           TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shopify_orders_customer_idx ON shopify_orders (customer_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS shopify_orders_shopify_customer_idx ON shopify_orders (shopify_customer_gid);

CREATE OR REPLACE VIEW customer_purchases AS
  SELECT 'store'::text                              AS channel,
         ps.id::text                                AS ref,
         ps.sale_number                             AS number,
         ps.customer_id,
         COALESCE(ps.completed_at, ps.created_at)   AS placed_at,
         ps.total_amount                            AS total,
         ps.status                                  AS status,
         loc.name                                   AS location_name,
         (SELECT COALESCE(SUM(l.quantity), 0)::int FROM pos_sale_lines l
           WHERE l.sale_id = ps.id AND l.line_type <> 'loyalty_redemption')
                                                    AS item_count
    FROM pos_sales ps
    LEFT JOIN pos_locations pl ON pl.id = ps.pos_location_id
    LEFT JOIN locations loc    ON loc.id = pl.wms_location_id
   WHERE ps.customer_id IS NOT NULL
     AND ps.status IN ('completed', 'refunded')
  UNION ALL
  SELECT 'online'::text,
         so.order_gid,
         so.order_name,
         so.customer_id,
         so.processed_at,
         so.total,
         CASE WHEN so.cancelled_at IS NOT NULL THEN 'cancelled'
              WHEN so.financial_status = 'refunded' THEN 'refunded'
              WHEN so.financial_status = 'partially_refunded' THEN 'partially_refunded'
              ELSE 'completed' END,
         'Online'::text,
         (SELECT COALESCE(SUM((li->>'quantity')::int), 0)::int FROM jsonb_array_elements(so.line_items) li)
    FROM shopify_orders so
   WHERE so.customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_sync_outbox (
  customer_id  INT PRIMARY KEY REFERENCES pos_customers(id) ON DELETE CASCADE,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INT NOT NULL DEFAULT 0,
  last_error   TEXT
);

CREATE OR REPLACE FUNCTION queue_customer_shopify_sync() RETURNS trigger AS $$
BEGIN
  IF current_setting('carbon.sync_origin', true) = 'shopify' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.first_name IS NOT DISTINCT FROM OLD.first_name
     AND NEW.last_name  IS NOT DISTINCT FROM OLD.last_name
     AND NEW.email      IS NOT DISTINCT FROM OLD.email
     AND NEW.phone      IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  -- Nothing Shopify could identify the customer by.
  IF NULLIF(trim(COALESCE(NEW.email, '')), '') IS NULL
     AND NULLIF(trim(COALESCE(NEW.phone, '')), '') IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO customer_sync_outbox (customer_id) VALUES (NEW.id)
    ON CONFLICT (customer_id) DO UPDATE
      SET queued_at = now(), attempts = 0, last_error = NULL;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pos_customers_shopify_sync ON pos_customers;
CREATE TRIGGER pos_customers_shopify_sync
  AFTER INSERT OR UPDATE OF first_name, last_name, email, phone ON pos_customers
  FOR EACH ROW EXECUTE FUNCTION queue_customer_shopify_sync();
