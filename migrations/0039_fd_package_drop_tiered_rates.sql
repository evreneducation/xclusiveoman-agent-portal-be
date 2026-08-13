-- Tiered per-agency-tier pricing (Gold/Silver/Bronze) is replaced by a single
-- net rate per pax computed from the package's day-by-day itinerary (sum of
-- each placed hotel night / tour / transfer / activity's catalog price) —
-- see computeNetRatePerPax in fdPackages.model.js. Nothing else read
-- agency.tier for pricing, so the tier column itself stays on agencies.
ALTER TABLE fd_packages DROP COLUMN rate_gold;
ALTER TABLE fd_packages DROP COLUMN rate_silver;
ALTER TABLE fd_packages DROP COLUMN rate_bronze;
