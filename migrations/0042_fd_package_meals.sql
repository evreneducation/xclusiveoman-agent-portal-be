-- Optional lunch/dinner add-ons for an FD package: admin picks one lunch
-- meal-catalog entry and/or one dinner entry, a headcount, and a day count.
-- The total (meal.price_per_person * people * days, per selected meal type)
-- feeds into the package's auto-computed net rate alongside the itinerary
-- total — see computeMealsCost in fdPackages.model.js.
ALTER TABLE fd_packages ADD COLUMN lunch_meal_id UUID REFERENCES meals(id);
ALTER TABLE fd_packages ADD COLUMN lunch_people INT;
ALTER TABLE fd_packages ADD COLUMN lunch_days INT;
ALTER TABLE fd_packages ADD COLUMN dinner_meal_id UUID REFERENCES meals(id);
ALTER TABLE fd_packages ADD COLUMN dinner_people INT;
ALTER TABLE fd_packages ADD COLUMN dinner_days INT;
