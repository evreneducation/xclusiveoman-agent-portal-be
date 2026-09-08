-- Partial index (WHERE status = 'scheduled') has no MySQL equivalent. A
-- plain composite index on (status, scheduled_at) is used instead — it
-- still directly serves the scheduler job's "find due campaigns" poll
-- (marketingScheduler.job.js), just without the smaller-index-size
-- optimization the filter gave in Postgres.
CREATE INDEX idx_marketing_campaigns_scheduled ON marketing_campaigns(status, scheduled_at);
