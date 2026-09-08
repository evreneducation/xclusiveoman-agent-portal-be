-- The ALTER TYPE ... ADD VALUE statements this file originally had are
-- no-ops under MySQL — 'scheduled'/'cancelled' are already folded into
-- marketing_campaigns.status's ENUM list in 0032_marketing_campaigns.sql.
ALTER TABLE marketing_campaigns ADD COLUMN scheduled_at DATETIME;
