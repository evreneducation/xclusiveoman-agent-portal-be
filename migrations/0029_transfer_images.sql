-- Transfers (doc §11.2) never got an images column the way hotels/tours/
-- activities did (0005_catalog.sql) — added now so the Product Catalog admin
-- Transfer form can offer the same photo-upload option those already have.
-- Nullable-equivalent default, same as the other catalog images columns,
-- since existing rows predate it.
ALTER TABLE transfers
  ADD COLUMN images TEXT[] DEFAULT '{}';
