-- Product Catalog "Visa" tab — a single admin-priced rate (per person), not
-- a list like Inclusions/Exclusions or Meals' lunch/dinner types. The admin
-- UI (ProductCatalog.jsx's VisaTab, mirroring MealsTab) only ever edits one
-- row in place rather than offering a separate "Add" flow, same convention
-- Meals already uses for "only one entry per type" — there's no DB-level
-- constraint enforcing that here either, it's a UI convention.
CREATE TABLE visa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_per_person NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
