-- FD meals move from always-included columns on fd_packages to opt-in
-- fd_addons rows, exactly like activities/tours/transfers/flights already are.

ALTER TABLE fd_addons ADD COLUMN meal_id CHAR(36);
ALTER TABLE fd_addons ADD CONSTRAINT fk_fd_addons_meal FOREIGN KEY (meal_id) REFERENCES meals(id);

ALTER TABLE fd_addons DROP CHECK fd_addons_exactly_one_item;
ALTER TABLE fd_addons ADD CONSTRAINT fd_addons_exactly_one_item CHECK (
  (CASE WHEN activity_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN tour_id     IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN transfer_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN flight_id   IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN meal_id     IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- Backfill: every package that had a lunch and/or dinner meal selected gets
-- one fd_addons row per meal type, priced price_per_day x that package's
-- Duration. Rewritten from the original's `CROSS JOIN LATERAL (VALUES ...)`
-- (Postgres-only) as two unioned INSERT...SELECTs (one per meal slot) —
-- simpler and portable, and equivalent since lunch/dinner were always
-- resolved independently anyway. Duration is a free-text string ("7 Days",
-- "5", "6N/7D", …); the day count is the first run of digits immediately
-- before a "D"/"d", falling back to the first run of digits anywhere, else 0
-- — same "0 when it doesn't parse" guard the original had. Postgres's
-- `substring(x from '(\d+)\s*[Dd]')` (regex capture group) becomes
-- REGEXP_SUBSTR (whole-match, no capture groups in MySQL) followed by
-- REGEXP_REPLACE to strip the trailing letter/whitespace back to just digits.
-- ids are generated here with MySQL's UUID() (a one-time seed/backfill
-- statement, not app code) since there's no app-layer id to reuse for the
-- new rows.
INSERT INTO fd_addons (id, fd_package_id, meal_id, price_per_pax)
SELECT UUID(), p.id, p.lunch_meal_id,
       COALESCE(m.price_per_day, 0) * COALESCE(
         NULLIF(CAST(REGEXP_REPLACE(REGEXP_SUBSTR(p.duration, '[0-9]+[[:space:]]*[Dd]'), '[^0-9]', '') AS UNSIGNED), 0),
         NULLIF(CAST(REGEXP_REPLACE(REGEXP_SUBSTR(p.duration, '[0-9]+'), '[^0-9]', '') AS UNSIGNED), 0),
         0
       )
FROM fd_packages p
JOIN meals m ON m.id = p.lunch_meal_id
WHERE p.lunch_meal_id IS NOT NULL
UNION ALL
SELECT UUID(), p.id, p.dinner_meal_id,
       COALESCE(m.price_per_day, 0) * COALESCE(
         NULLIF(CAST(REGEXP_REPLACE(REGEXP_SUBSTR(p.duration, '[0-9]+[[:space:]]*[Dd]'), '[^0-9]', '') AS UNSIGNED), 0),
         NULLIF(CAST(REGEXP_REPLACE(REGEXP_SUBSTR(p.duration, '[0-9]+'), '[^0-9]', '') AS UNSIGNED), 0),
         0
       )
FROM fd_packages p
JOIN meals m ON m.id = p.dinner_meal_id
WHERE p.dinner_meal_id IS NOT NULL;

ALTER TABLE fd_packages
  DROP FOREIGN KEY fk_fd_packages_lunch_meal,
  DROP FOREIGN KEY fk_fd_packages_dinner_meal;

ALTER TABLE fd_packages
  DROP COLUMN lunch_meal_id,
  DROP COLUMN lunch_people,
  DROP COLUMN lunch_days,
  DROP COLUMN dinner_meal_id,
  DROP COLUMN dinner_people,
  DROP COLUMN dinner_days;
