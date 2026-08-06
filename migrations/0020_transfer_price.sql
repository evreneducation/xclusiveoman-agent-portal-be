-- Transfers (doc §11.2) never got a price column the way hotels/tours did
-- (0014_hotel_details.sql / 0015_tour_details.sql) — required now so the
-- Quote Details "Landing Cost Breakdown" can auto-calculate a Transfer Total
-- from the Product Catalog like every other component. Nullable, same as
-- the other catalog price columns, since existing rows predate it.
ALTER TABLE transfers
  ADD COLUMN price NUMERIC;
