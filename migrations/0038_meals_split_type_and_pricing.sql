ALTER TABLE meals ADD COLUMN meal_type TEXT;
ALTER TABLE meals ADD COLUMN price_per_person DECIMAL(12,2);
ALTER TABLE meals ADD COLUMN price_per_day DECIMAL(12,2);

-- Backfill: clone a 'dinner' row for every existing row that had a dinner
-- price. id is generated here with MySQL's UUID() (a one-time seed/backfill
-- statement, not app code) since there's no app-layer id to reuse for the
-- new clone rows.
INSERT INTO meals (id, name, city, description, meal_type, price_per_person, created_at, updated_at)
  SELECT UUID(), name, city, description, 'dinner', dinner_price_per_pax, created_at, updated_at
  FROM meals
  WHERE dinner_price_per_pax IS NOT NULL;

UPDATE meals SET meal_type = 'lunch', price_per_person = lunch_price_per_pax WHERE meal_type IS NULL;

ALTER TABLE meals MODIFY COLUMN meal_type TEXT NOT NULL;
ALTER TABLE meals ADD CONSTRAINT meals_meal_type_check CHECK (meal_type IN ('lunch', 'dinner'));

ALTER TABLE meals DROP COLUMN lunch_price_per_pax;
ALTER TABLE meals DROP COLUMN dinner_price_per_pax;
