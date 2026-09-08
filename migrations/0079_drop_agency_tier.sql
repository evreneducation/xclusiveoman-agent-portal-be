-- No separate DROP TYPE needed under MySQL — agency_tier was never a
-- standalone type here, just an inline ENUM on this one column, so dropping
-- the column removes it entirely.
ALTER TABLE agencies DROP COLUMN tier;
