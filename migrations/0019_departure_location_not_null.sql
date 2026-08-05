-- Location is a required field on every departure date, not optional.
-- Backfill any existing NULLs first (none as of writing) so the NOT NULL
-- constraint can be added safely regardless of existing data.
UPDATE fd_departure_dates SET location = 'Mumbai' WHERE location IS NULL;

ALTER TABLE fd_departure_dates ALTER COLUMN location SET NOT NULL;
