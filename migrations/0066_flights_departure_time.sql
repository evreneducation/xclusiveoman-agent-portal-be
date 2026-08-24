-- Product Catalog "Flights" tab (ProductCatalog.jsx's FlightForm) — the admin
-- already enters a departure date (0063_flights_catalog.sql); this adds the
-- departure time alongside it, so both the agent's Flight Details section
-- (DepartureDetail.jsx) and the admin's flight picker (FdPackageEditor.jsx's
-- flightOptionLabel) can show a full date + time instead of the date alone.
-- Nullable, same as price (0065_flights_price.sql) — an existing flight
-- predates this column and simply renders with no time until edited.
ALTER TABLE flights ADD COLUMN departure_time TIME;
