-- Lunch/Dinner add-ons can now be limited to specific itinerary days rather
-- than always covering a FD package's full duration — the agent picks a day
-- count (capped at the package's day-by-day itinerary length) via
-- DepartureDetail.jsx, then checks which specific itinerary days it applies
-- to, lunch and dinner selected independently. Every other addon type
-- (activity/tour/transfer/flight) leaves this empty and still covers the
-- whole trip exactly as before.
ALTER TABLE booking_addons ADD COLUMN day_numbers INT[] NOT NULL DEFAULT '{}';
