-- Day-wise Itinerary Planner (FIT-5) — "allow editing itinerary items".
-- Day-level notes already existed (package_request_itinerary_days.notes);
-- this adds a per-item note so an individual hotel/tour/transfer/extra
-- placed on a day can carry its own short annotation (e.g. "9am pickup"),
-- separate from the day's overall note.
ALTER TABLE package_request_itinerary_items
  ADD COLUMN note TEXT;
