-- Product Catalog "Flights" tab (ProductCatalog.jsx's FlightsTab) — a plain
-- growable list, not a singleton like Meals/Visa: any number of onward and
-- return flights can be added. Onward vs Return is one table distinguished
-- by is_flight_onward (true = added under the Onward sub-tab, false =
-- Return), the same "one table, a boolean/type column tells them apart"
-- convention meals.meal_type already uses for Lunch/Dinner.
CREATE TABLE flights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_date DATE NOT NULL,
  is_flight_onward BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX flights_is_flight_onward_idx ON flights (is_flight_onward);
