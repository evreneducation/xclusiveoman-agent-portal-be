-- Meals: Lunch and Dinner become fully independent catalog entries (separate
-- tabs + separate saves in the admin UI) instead of two price columns on one
-- row. Each row now carries a single `meal_type` ('lunch' | 'dinner'), plus
-- two independent flat rates — `price_per_person` and `price_per_day` — in
-- place of the old combined per-pax-per-day figure. The two rates are
-- captured and shown separately; neither is multiplied against the other or
-- against a headcount/day-count here.
ALTER TABLE meals ADD COLUMN meal_type TEXT;
ALTER TABLE meals ADD COLUMN price_per_person NUMERIC;
ALTER TABLE meals ADD COLUMN price_per_day NUMERIC;

-- Backfill: clone a 'dinner' row for every existing row that had a dinner
-- price, carrying that price into price_per_person (closest prior meaning —
-- there's no prior data to derive a price_per_day from). Must run before the
-- collapse below, since the dinner price only exists on the original row up
-- to this point.
INSERT INTO meals (name, city, description, meal_type, price_per_person, created_at, updated_at)
  SELECT name, city, description, 'dinner', dinner_price_per_pax, created_at, updated_at
  FROM meals
  WHERE dinner_price_per_pax IS NOT NULL;

-- Collapse every original row down to 'lunch', carrying over its lunch price
-- into price_per_person (NULL if it never had one, same optional behavior as
-- before). WHERE meal_type IS NULL excludes the clones just inserted above,
-- which already have meal_type = 'dinner' set.
UPDATE meals SET meal_type = 'lunch', price_per_person = lunch_price_per_pax WHERE meal_type IS NULL;

ALTER TABLE meals ALTER COLUMN meal_type SET NOT NULL;
ALTER TABLE meals ADD CONSTRAINT meals_meal_type_check CHECK (meal_type IN ('lunch', 'dinner'));

ALTER TABLE meals DROP COLUMN lunch_price_per_pax;
ALTER TABLE meals DROP COLUMN dinner_price_per_pax;
