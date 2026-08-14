-- Optional Visa add-on for a Custom FIT request — the agent toggles it on
-- in the Package Builder (agent/pages/PackageBuilder.jsx, right after
-- Meals) and enters a headcount capped to the trip's adults (pax_adults),
-- same "no price shown to the agent" convention as every other add-on here.
-- visa_people is nullable/independent of visa_enabled (mirrors
-- lunch_meal_id/lunch_people not being collapsed into one flag) so
-- toggling off keeps visa_enabled meaningful as the single source of truth
-- for "is Visa included" without relying on visa_people's nullness alone.
ALTER TABLE package_requests ADD COLUMN visa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE package_requests ADD COLUMN visa_people INT;
