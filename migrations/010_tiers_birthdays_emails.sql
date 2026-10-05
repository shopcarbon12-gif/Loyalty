-- 010_tiers_birthdays_emails.sql
-- Turns on the parts of the program that were configured but never ran:
--
-- loyalty_member_tiers — each member's current tier, recomputed by the daily
--   batch (/api/cron/daily at loyalty_settings.tier_batch_hour_est, ET) from
--   the lifetime tier_qualifying_metric. The tier's earn_multiplier applies to
--   every earn.
-- loyalty_job_runs — makes the daily batch (tiers + birthday bonuses) run
--   once per day however often the hourly cron fires.
-- loyalty_comms_log gains a queue: rows are inserted 'queued' with a payload
--   and /api/cron/send-emails delivers them through Resend.
-- loyalty_settings.emails_enabled — master switch for member emails.

CREATE TABLE IF NOT EXISTS loyalty_member_tiers (
  customer_id   INT PRIMARY KEY REFERENCES pos_customers(id) ON DELETE CASCADE,
  tier_code     TEXT NOT NULL REFERENCES loyalty_tiers(code) ON UPDATE CASCADE,
  metric_value  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_member_tiers_tier_idx ON loyalty_member_tiers (tier_code);

CREATE TABLE IF NOT EXISTS loyalty_job_runs (
  job       TEXT NOT NULL,
  run_date  DATE NOT NULL,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  result    JSONB,
  PRIMARY KEY (job, run_date)
);

ALTER TABLE loyalty_comms_log
  ADD COLUMN IF NOT EXISTS subject  TEXT,
  ADD COLUMN IF NOT EXISTS payload  JSONB,
  ADD COLUMN IF NOT EXISTS sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
-- One email per event (e.g. the birthday email for a member in a given year).
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_comms_log_dedupe_uq
  ON loyalty_comms_log (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_comms_log_queued_idx
  ON loyalty_comms_log (created_at) WHERE status = 'queued';

ALTER TABLE loyalty_settings
  ADD COLUMN IF NOT EXISTS emails_enabled BOOLEAN NOT NULL DEFAULT true;
