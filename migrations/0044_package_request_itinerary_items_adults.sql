-- Hotel occupancy for the Custom FIT Package Builder's itinerary, same rule
-- as FD packages (0043_fd_itinerary_items_adults.sql): how many adults are
-- sharing the room placed on a given day. Only meaningful for item_type =
-- 'hotel'. NULL means "not set" — computeHotelCostAuto/roomsForAdults treats
-- that as 1 room, matching prior (pre-occupancy) flat per-night pricing so
-- already-saved requests don't silently reprice.
ALTER TABLE package_request_itinerary_items ADD COLUMN adults INT;
