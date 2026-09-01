-- Agency Tier (Gold/Silver/Bronze) removed entirely — no longer assigned
-- during approval, shown on the agent dashboard/profile, filterable in
-- Analytics, or targetable as a Marketing Center audience segment. FD
-- package pricing already stopped being tiered by this
-- (0039_fd_package_drop_tiered_rates.sql); this drops the now-unused
-- column/enum since nothing in the app reads or writes it anymore.
ALTER TABLE agencies DROP COLUMN tier;
DROP TYPE agency_tier;
