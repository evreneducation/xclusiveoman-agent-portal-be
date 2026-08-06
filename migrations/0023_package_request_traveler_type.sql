-- Traveller Details (PackageBuilder.jsx): whether the passport field applies
-- to a traveler depends on adult vs child, so each row needs an explicit
-- type rather than relying on array position — package_request_travelers.id
-- is a random UUID, so "first N rows are adults" can't be inferred from
-- insertion/select order.
ALTER TABLE package_request_travelers
  ADD COLUMN is_child BOOLEAN NOT NULL DEFAULT false;
