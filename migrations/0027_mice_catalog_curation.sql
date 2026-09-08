ALTER TABLE tours ADD COLUMN is_mice_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE transfers ADD COLUMN is_mice_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE activities ADD COLUMN is_mice_enabled BOOLEAN NOT NULL DEFAULT false;
