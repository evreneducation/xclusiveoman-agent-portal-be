-- Split out of 0033_marketing_campaign_scheduling.sql: Postgres forbids using
-- a brand-new enum value (marketing_campaign_status's 'scheduled', added in
-- 0033) inside the same transaction that added it, and the migration runner
-- wraps each file in one transaction — so this partial index has to run as
-- its own migration, once 0033 has committed.
--
-- Backs the scheduler job's "find due campaigns" poll (marketingScheduler.job.js)
-- — partial so the index only covers rows that could possibly still be due.
CREATE INDEX idx_marketing_campaigns_scheduled ON marketing_campaigns(scheduled_at) WHERE status = 'scheduled';
