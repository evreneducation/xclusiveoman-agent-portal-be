-- Replaces the numeric "adults sharing this room" capture (0044) with a
-- named occupancy type — the Package Builder already knows headcount from
-- Trip Details (package_requests.pax_adults), so a per-hotel-day input only
-- needs to say how they're splitting into rooms, not the count again.
-- Rooms = ceil(pax_adults / capacity), capacity 1/2/3 for single/double/
-- triple — see roomsForOccupancy in src/utils/occupancy.js. Only meaningful
-- for item_type = 'hotel'.
ALTER TABLE package_request_itinerary_items DROP COLUMN adults;
ALTER TABLE package_request_itinerary_items ADD COLUMN occupancy TEXT CHECK (occupancy IN ('single', 'double', 'triple'));
