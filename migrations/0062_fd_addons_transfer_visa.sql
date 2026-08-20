-- Task 5 (checkbox-driven Activities/Tours/Transfers/Visa/Meals add-ons) -
-- fd_addons gains transfer_id alongside its existing activity_id/tour_id, so
-- Transfers can be offered as a paid add-on the same way Activities/Tours
-- already are.
ALTER TABLE fd_addons ADD COLUMN transfer_id UUID REFERENCES transfers(id);

-- Replaces the old "exactly one of activity_id/tour_id" check (0006_fd_packages.sql)
-- with "exactly one of activity_id/tour_id/transfer_id". fd_addons_check is
-- the name Postgres auto-generates for that table's one unnamed inline
-- CHECK constraint.
ALTER TABLE fd_addons DROP CONSTRAINT fd_addons_check;
ALTER TABLE fd_addons ADD CONSTRAINT fd_addons_exactly_one_item CHECK (
  (CASE WHEN activity_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN tour_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN transfer_id IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- Visa is a simple "included or not" flag on the package itself, not a
-- fd_addons row - there's only ever one Visa product (same reason Meals
-- isn't a multi-select either), so no catalog picker is needed, just a
-- checkbox. Mirrors package_requests.visa_enabled (Custom FIT's own visa
-- flag, 0052_package_request_visa.sql) - FD's own copy of the same idea,
-- not a shared column (FD and FIT packages are different tables).
ALTER TABLE fd_packages ADD COLUMN visa_enabled BOOLEAN NOT NULL DEFAULT false;
