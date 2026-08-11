-- Marketing Center Task 6 — Schedule Campaign. Reuses Task 5's
-- marketing_campaigns table (migrations/0032) rather than a second
-- campaign table — just two new lifecycle states and the UTC instant a
-- scheduled send is due, both additive.
--
-- ALTER TYPE ... ADD VALUE is safe as its own migration file: Postgres only
-- restricts using a brand-new enum value in the *same* transaction that
-- added it. The migration runner (src/db/migrate.js) wraps each file's SQL
-- in one transaction, so the partial index below — which filtered on the
-- new 'scheduled' value — has to live in its own follow-up migration file
-- instead (0035_marketing_campaign_scheduled_index.sql) rather than this one.
ALTER TYPE marketing_campaign_status ADD VALUE 'scheduled';
ALTER TYPE marketing_campaign_status ADD VALUE 'cancelled';

-- Always UTC, same as every other TIMESTAMPTZ column in this schema — the
-- admin's chosen date/time/timezone is converted to a UTC instant before
-- being written here (see src/utils/timezone.js), never the raw local
-- wall-clock values.
ALTER TABLE marketing_campaigns ADD COLUMN scheduled_at TIMESTAMPTZ;
