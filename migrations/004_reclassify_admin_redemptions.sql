-- 004_reclassify_admin_redemptions.sql
-- Historical fix: the old admin "Redeem points" form wrote
-- reason='redemption' on rows it created (source='admin'). Those were
-- always manager overrides, never customer redemptions, so they
-- polluted both the Reason column on customer detail and the "Points
-- redeemed" dashboard KPI.
--
-- After this migration, reason='redemption' means exclusively a live
-- customer redemption from POS or Shopify. Manager adjustments are
-- always reason='manual'.
--
-- Idempotent: the WHERE clause matches nothing on re-run.

UPDATE loyalty_ledger
   SET reason = 'manual'
 WHERE source = 'admin'
   AND reason = 'redemption';
