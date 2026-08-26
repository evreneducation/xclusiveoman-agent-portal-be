-- Extends 0070_hotels_status.sql's draft/published pattern to tours,
-- activities, and transfers — same reasons: HotelEditor.jsx's sibling
-- editors (TourEditor.jsx/ActivityEditor.jsx/TransferEditor.jsx) get the
-- same draft-autosave treatment, and the itinerary-building pickers
-- (FdPackageEditor.jsx/PackageBuilder.jsx/MiceBuilder.jsx) should only offer
-- published rows for these too. One shared enum across all three tables —
-- unlike hotel_status, no need to clone it per table since these three are
-- being added together.
CREATE TYPE catalog_status AS ENUM ('draft', 'published');

-- DEFAULT 'published' so this is a no-op for every row that already exists
-- (same reasoning as 0070_hotels_status.sql).
ALTER TABLE tours ADD COLUMN status catalog_status NOT NULL DEFAULT 'published';
ALTER TABLE activities ADD COLUMN status catalog_status NOT NULL DEFAULT 'published';
ALTER TABLE transfers ADD COLUMN status catalog_status NOT NULL DEFAULT 'published';

-- Same fix as 0071_hotels_nullable_name_city.sql, done up front this time —
-- these were NOT NULL at the DB layer since long before drafts existed, and
-- without dropping that too, the very first draft autosave (usually just
-- `name` typed so far) fails the INSERT outright.
ALTER TABLE tours ALTER COLUMN name DROP NOT NULL;
ALTER TABLE tours ALTER COLUMN city DROP NOT NULL;
ALTER TABLE activities ALTER COLUMN name DROP NOT NULL;
ALTER TABLE activities ALTER COLUMN city DROP NOT NULL;
ALTER TABLE transfers ALTER COLUMN name DROP NOT NULL;
ALTER TABLE transfers ALTER COLUMN type DROP NOT NULL;
