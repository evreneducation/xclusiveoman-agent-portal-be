-- Hotel occupancy: how many adults are sharing the room placed on a given
-- day. Only meaningful for item_type = 'hotel' (ignored for tour/transfer/
-- activity rows). NULL means "not set" — computeNetRatePerPax treats that as
-- 1 room, matching prior (pre-occupancy) flat per-night pricing so already-
-- saved itineraries don't silently reprice. Rooms needed are computed as
-- ceil(adults / 2) — a room holds up to 2 adults at the hotel's single
-- price_per_night rate; 3+ adults just means more rooms, not a higher rate
-- per room. See computeNetRatePerPax in fdPackages.model.js.
ALTER TABLE fd_itinerary_items ADD COLUMN adults INT;
