-- Net rate per pax defaults to the sum of the day-by-day itinerary (see
-- computeNetRatePerPax in fdPackages.model.js), but admin can override it
-- with a specific sell price. NULL means "no override — use the itinerary
-- total"; every reader (admin catalog, agent listing/detail, booking) treats
-- this column as the source of truth when set and falls back to the computed
-- itinerary total otherwise.
ALTER TABLE fd_packages ADD COLUMN rate_per_pax NUMERIC;
