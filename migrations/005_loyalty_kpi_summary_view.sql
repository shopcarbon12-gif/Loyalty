-- 005_loyalty_kpi_summary_view.sql
-- Single source of truth for the top-level loyalty KPIs (Members /
-- Points awarded / Points redeemed) that BOTH dashboards surface:
-- rewards.shopcarbon.com/admin and wms.shopcarbon.com/loyalty.
--
-- Before this view, each app hand-rolled its own SUM(...) over
-- loyalty_ledger. The definitions drifted: WMS counted reason='manual'
-- (manager overrides) as "awarded" and dropped the source guard, so its
-- numbers ran higher than the Rewards admin's. The fix is to define the
-- math once, here, and have both apps SELECT from it.
--
-- Definition (matches the Rewards admin's intent, see migration 004):
--   * Members  — distinct customers that appear in the ledger.
--   * Awarded  — organic earns only: positive deltas from a live POS or
--                Shopify source for sale/signup/birthday/referral. Manual
--                manager adjustments (reason='manual', source='admin') are
--                staff intervention, NOT awards, so they are excluded.
--   * Redeemed — live customer redemptions only (reason='redemption' from
--                POS or Shopify). After migration 004 no admin row can
--                carry reason='redemption', but the source guard keeps
--                this correct even if one is ever mis-classified.
--   * Refunded — points returned to the program (reason='refund').
--
-- One row, always. Idempotent via CREATE OR REPLACE.

CREATE OR REPLACE VIEW loyalty_kpi_summary AS
SELECT
  (SELECT COUNT(DISTINCT customer_id)
     FROM loyalty_ledger
    WHERE customer_id IS NOT NULL)::bigint AS members,
  COALESCE(SUM(CASE WHEN delta_points > 0
                      AND source IN ('pos','shopify')
                      AND reason IN ('sale','signup_bonus','birthday_bonus','referral_bonus')
                     THEN delta_points ELSE 0 END), 0)::bigint AS points_awarded,
  COALESCE(SUM(CASE WHEN reason = 'redemption'
                      AND source IN ('pos','shopify')
                     THEN -delta_points ELSE 0 END), 0)::bigint AS points_redeemed,
  COALESCE(SUM(CASE WHEN reason = 'refund'
                     THEN delta_points ELSE 0 END), 0)::bigint AS points_refunded
FROM loyalty_ledger;
