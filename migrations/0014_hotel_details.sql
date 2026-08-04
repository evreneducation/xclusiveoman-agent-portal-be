-- Extends the Hotel Catalog (admin §12.3) with the fields the richer Admin
-- Hotel module needs: state/address/email for the property's business
-- details, and price per night (INR) for merchandising display. Nullable at
-- the DB level since existing rows may predate these columns — "required" is
-- enforced by hotelSchema (validation/schemas.js) on writes through the API.
ALTER TABLE hotels
  ADD COLUMN state TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN price_per_night NUMERIC;
