-- FD Package Editor "Flights" section (below the day-by-day itinerary) —
-- admin picks at most one Onward and one Return flight to include directly
-- on the package, mutually exclusive with offering flights as a checkbox
-- add-on instead (fd_addons.flight_id below); which mode is active is a UI
-- decision (FdPackageEditor.jsx's flightsEnabled toggle), not enforced at
-- the DB level, same "the editor itself is the only gate" convention the
-- itinerary-completeness and carousel-image-count rules already use.
ALTER TABLE fd_packages
  ADD COLUMN flights_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN onward_flight_id UUID REFERENCES flights(id),
  ADD COLUMN return_flight_id UUID REFERENCES flights(id);

-- Flights as a paid add-on — same shape as Activities/Tours/Transfers
-- (0062_fd_addons_transfer_visa.sql), just a 4th mutually-exclusive option.
-- price_per_pax stays NOT NULL on fd_addons; the controller resolves it to 0
-- for a flight (the flights catalog has no price column), same "priced at
-- booking time" posture the rest of the FD package pricing model already has
-- for anything without its own catalog rate.
ALTER TABLE fd_addons ADD COLUMN flight_id UUID REFERENCES flights(id);
ALTER TABLE fd_addons DROP CONSTRAINT fd_addons_exactly_one_item;
ALTER TABLE fd_addons ADD CONSTRAINT fd_addons_exactly_one_item CHECK (
  (CASE WHEN activity_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN tour_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN transfer_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN flight_id IS NOT NULL THEN 1 ELSE 0 END) = 1
);
