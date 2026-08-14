-- Product Catalog "Inclusions & Exclusions" tab, next to Meals — reusable,
-- name-only phrases the admin curates once (e.g. "Daily breakfast",
-- "International flights") for reference when typing a quotation's
-- client-facing Inclusions/Exclusions text (Quote Inbox's Costing panel,
-- package_requests.inclusions/exclusions — see
-- 0048_package_request_inclusions_exclusions.sql). Two bare tables rather
-- than one type-discriminated table, so each gets a clean CRUD entity/route
-- via the existing generic catalog machinery (catalog.model.js's
-- createCrudModel, catalog.routes.js's ENTITIES list) — same shape as
-- hotels/tours/meals, just name-only.
CREATE TABLE inclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
