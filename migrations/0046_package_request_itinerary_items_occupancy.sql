ALTER TABLE package_request_itinerary_items DROP COLUMN adults;
ALTER TABLE package_request_itinerary_items ADD COLUMN occupancy TEXT CHECK (occupancy IN ('single', 'double', 'triple'));
