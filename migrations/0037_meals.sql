-- Meals catalog entity (Product Catalog "Meals" tab) — a simple ancillary
-- entity like transfers/experiences, not a primary listing like hotels/tours,
-- so city is optional. Rate is captured per pax per day, split by meal type
-- (lunch/dinner) rather than a single `price` column, since the two are
-- priced independently.
CREATE TABLE meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT,
  description TEXT,
  lunch_price_per_pax NUMERIC,
  dinner_price_per_pax NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
