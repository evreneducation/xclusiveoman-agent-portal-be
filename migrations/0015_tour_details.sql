-- Extends the Tour Catalog (admin §12.3) with the fields the richer Admin
-- Tours module needs: a tour category descriptor and price (INR). Nullable
-- at the DB level since existing rows may predate these columns —
-- "required" is enforced by tourSchema (validation/schemas.js) on writes
-- through the API.
ALTER TABLE tours
  ADD COLUMN category TEXT,
  ADD COLUMN price NUMERIC;
