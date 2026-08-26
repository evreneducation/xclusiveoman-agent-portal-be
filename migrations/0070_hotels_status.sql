-- Hotels catalog status (mirrors fd_package_status, 0006_fd_packages.sql) —
-- itinerary-building pickers (FD Package/Custom FIT/MICE builders) now only
-- offer 'published' hotels; the admin management lists (ProductCatalog.jsx's
-- Hotels tab, MiceCatalog.jsx's MiceHotelsTab) stay unfiltered so drafts are
-- still visible there to finish/manage. No 'closed' value yet (unlike FD
-- packages) — nothing in the product asks for that today, just
-- draft/published; add it later if a real need shows up.
--
-- DEFAULT 'published' (not 'draft') so this is a no-op for every hotel that
-- already exists — they were all implicitly "live" before this column
-- existed, and Postgres applies a constant DEFAULT to existing rows too.
CREATE TYPE hotel_status AS ENUM ('draft', 'published');

ALTER TABLE hotels ADD COLUMN status hotel_status NOT NULL DEFAULT 'published';
