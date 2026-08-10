-- Marketing Center Task 6 — Schedule Campaign. Reuses Task 5's
-- marketing_campaigns table (migrations/0032) rather than a second
-- campaign table — just two new lifecycle states and the UTC instant a
-- scheduled send is due, both additive.
--
-- ALTER TYPE ... ADD VALUE is safe as its own migration file: Postgres only
-- restricts using a brand-new enum value in the *same* transaction that
-- added it, and nothing here does that (the values are only ever written
-- by later, separate application queries).
ALTER TYPE marketing_campaign_status ADD VALUE 'scheduled';
ALTER TYPE marketing_campaign_status ADD VALUE 'cancelled';

-- Always UTC, same as every other TIMESTAMPTZ column in this schema — the
-- admin's chosen date/time/timezone is converted to a UTC instant before
-- being written here (see src/utils/timezone.js), never the raw local
-- wall-clock values.
ALTER TABLE marketing_campaigns ADD COLUMN scheduled_at TIMESTAMPTZ;

-- Backs the scheduler job's "find due campaigns" poll (marketingScheduler.job.js)
-- — partial so the index only covers rows that could possibly still be due.
CREATE INDEX idx_marketing_campaigns_scheduled ON marketing_campaigns(scheduled_at) WHERE status = 'scheduled';
