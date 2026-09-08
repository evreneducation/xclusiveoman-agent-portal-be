ALTER TABLE hotels
  ADD COLUMN state TEXT,
  ADD COLUMN address TEXT,
  ADD COLUMN email TEXT,
  ADD COLUMN price_per_night DECIMAL(12,2);
