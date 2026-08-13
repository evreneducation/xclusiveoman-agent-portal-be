-- Optional lunch/dinner add-ons for a Custom FIT request, same shape as FD
-- Packages (0042_fd_package_meals.sql): the agent picks a headcount and a
-- day count per meal type in the Package Builder; which meals-catalog entry
-- backs each type is resolved automatically by meal_type (see
-- src/utils/meals.js), not chosen by the agent. Feeds a new "Meals"
-- component in the admin's Landing Cost Breakdown (packageRequestsAdmin.
-- controller.js) — never shown to the agent as a price, same as every other
-- costing figure in this flow.
ALTER TABLE package_requests ADD COLUMN lunch_meal_id UUID REFERENCES meals(id);
ALTER TABLE package_requests ADD COLUMN lunch_people INT;
ALTER TABLE package_requests ADD COLUMN lunch_days INT;
ALTER TABLE package_requests ADD COLUMN dinner_meal_id UUID REFERENCES meals(id);
ALTER TABLE package_requests ADD COLUMN dinner_people INT;
ALTER TABLE package_requests ADD COLUMN dinner_days INT;
