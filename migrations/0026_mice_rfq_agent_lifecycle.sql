-- The 'draft'/'revision_requested' ALTER TYPE ... ADD VALUE statements this
-- file originally had are no-ops under MySQL — both values are already
-- folded into mice_rfqs.status's ENUM list in 0024_mice_rfqs.sql (in the
-- same BEFORE 'submitted' / AFTER 'published' positions this file
-- originally inserted them at). The real schema change below (nullable
-- draft columns) still applies.
ALTER TABLE mice_rfqs
  MODIFY COLUMN group_size INT NULL,
  MODIFY COLUMN event_date_from DATE NULL,
  MODIFY COLUMN event_date_to DATE NULL;
