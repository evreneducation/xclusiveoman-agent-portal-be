-- Fix MICE Curation Data Source: tours, transfers and activities had no
-- MICE-curation flag at all (unlike hotels, which already has
-- is_mice_enabled — see 0005_catalog.sql), so the Admin MICE Catalog and
-- Agent MICE Builder could not help but fall back to the full Product
-- Catalog for those three entity types. This mirrors the existing hotels
-- column exactly so the same createCrudModel `isMiceEnabled` filter
-- (src/models/catalog.model.js) works for all four.
ALTER TABLE tours ADD COLUMN is_mice_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE transfers ADD COLUMN is_mice_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE activities ADD COLUMN is_mice_enabled BOOLEAN NOT NULL DEFAULT false;
