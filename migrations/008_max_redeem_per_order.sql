-- 008_max_redeem_per_order.sql
-- Hard cap on the discount a member can take on one purchase, regardless
-- of balance: $30 (= 300 points at 10 pts/$). Enforced by POS redeem and
-- online reward codes (one code per order — codes don't combine).

ALTER TABLE loyalty_settings
  ADD COLUMN IF NOT EXISTS max_redeem_dollars_per_order NUMERIC(10, 2) NOT NULL DEFAULT 30;
