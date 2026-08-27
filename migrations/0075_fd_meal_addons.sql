-- FD meals move from always-included columns on fd_packages to opt-in
-- fd_addons rows, exactly like activities/tours/transfers/flights already are.
-- The agent picks lunch/dinner (if offered) at booking time and it's added on
-- top of the base per-pax rate — no longer folded into the advertised net
-- rate (resolveRatePerPax). Per-pax price = meals-catalog price_per_day x the
-- package's Duration in days, snapshotted here / on add (and recomputed by
-- updateFdPackage whenever Duration later changes).

ALTER TABLE fd_addons ADD COLUMN meal_id UUID REFERENCES meals(id);

ALTER TABLE fd_addons DROP CONSTRAINT fd_addons_exactly_one_item;
ALTER TABLE fd_addons ADD CONSTRAINT fd_addons_exactly_one_item CHECK (
  (CASE WHEN activity_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN tour_id     IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN transfer_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN flight_id   IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN meal_id     IS NOT NULL THEN 1 ELSE 0 END) = 1
);

-- Backfill: every package that had a lunch and/or dinner meal selected gets
-- one fd_addons row per meal type, priced price_per_day x that package's
-- Duration. Duration is a free-text string ("7 Days", "5", "6N/7D", …); the
-- day count is the first run of digits that precedes a "D" (matching the
-- app's parseDurationDays), falling back to the first run of digits anywhere,
-- else 0 — same "0 when it doesn't parse" guard the old computeFdMealsPerPax had.
INSERT INTO fd_addons (fd_package_id, meal_id, price_per_pax)
SELECT p.id, mid,
       COALESCE(m.price_per_day, 0) * COALESCE(
         NULLIF(substring(p.duration from '(\d+)\s*[Dd]'), '')::int,
         NULLIF(substring(p.duration from '(\d+)'), '')::int,
         0
       )
FROM fd_packages p
CROSS JOIN LATERAL (VALUES (p.lunch_meal_id), (p.dinner_meal_id)) AS v(mid)
JOIN meals m ON m.id = v.mid
WHERE v.mid IS NOT NULL;

ALTER TABLE fd_packages
  DROP COLUMN lunch_meal_id,
  DROP COLUMN lunch_people,
  DROP COLUMN lunch_days,
  DROP COLUMN dinner_meal_id,
  DROP COLUMN dinner_people,
  DROP COLUMN dinner_days;
