-- Inclusions/Exclusions for FD Packages — same client-facing, admin-authored
-- free text as Custom FIT quotes (0048_package_request_inclusions_exclusions.sql),
-- edited in FdPackageEditor.jsx the same way (Product Catalog's Inclusions/
-- Exclusions tab dropdown + an editable per-point list, admin/components/
-- InclusionExclusionList.jsx) and shown read-only to the agent on the
-- published departure (departures.controller.js).
ALTER TABLE fd_packages ADD COLUMN inclusions TEXT;
ALTER TABLE fd_packages ADD COLUMN exclusions TEXT;
