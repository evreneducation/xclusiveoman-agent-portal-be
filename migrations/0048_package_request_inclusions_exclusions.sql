-- Inclusions/Exclusions moved from an agent-authored, itinerary-derived
-- bullet list (0047_package_request_inclusions.sql) to admin-authored free
-- text set alongside costing when the admin prepares the quotation — the
-- agent no longer edits this in the Custom FIT Package Builder. Drops the
-- unused JSONB shape from 0047 and replaces it with two plain TEXT columns
-- the admin's Quote Details costing panel writes (packageRequestsAdmin.
-- controller.js's saveCosting) and the agent's own quote view reads
-- read-only once the quote is published (packageRequests.controller.js).
ALTER TABLE package_requests DROP COLUMN IF EXISTS inclusions;
ALTER TABLE package_requests ADD COLUMN inclusions TEXT;
ALTER TABLE package_requests ADD COLUMN exclusions TEXT;
