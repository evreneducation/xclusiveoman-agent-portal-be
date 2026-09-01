-- Product Catalog Tours/Activities/Transfers — pickup time for the guide/
-- driver to collect the traveler (ProductCatalog.jsx's TourEditor.jsx/
-- ActivityEditor.jsx/TransferEditor.jsx). Same TIME column + "HH:MM" input
-- convention as flights.departure_time (0066_flights_departure_time.sql).
-- Nullable at the DB layer for all three — mandatory-for-Tours/Activities vs
-- optional-for-Transfers is enforced at the publish-fields gate in
-- catalog.routes.js instead, same posture as every other per-entity required
-- field there.
ALTER TABLE tours ADD COLUMN pickup_time TIME;
ALTER TABLE activities ADD COLUMN pickup_time TIME;
ALTER TABLE transfers ADD COLUMN pickup_time TIME;
