-- Links an FD package to a single hotel from the general Hotel Catalog
-- (admin.12.3), selectable while creating/editing the package.
ALTER TABLE fd_packages ADD COLUMN hotel_id UUID REFERENCES hotels(id);
