ALTER TABLE package_requests ADD COLUMN lunch_meal_id CHAR(36);
ALTER TABLE package_requests ADD COLUMN lunch_people INT;
ALTER TABLE package_requests ADD COLUMN lunch_days INT;
ALTER TABLE package_requests ADD COLUMN dinner_meal_id CHAR(36);
ALTER TABLE package_requests ADD COLUMN dinner_people INT;
ALTER TABLE package_requests ADD COLUMN dinner_days INT;
ALTER TABLE package_requests ADD CONSTRAINT fk_package_requests_lunch_meal FOREIGN KEY (lunch_meal_id) REFERENCES meals(id);
ALTER TABLE package_requests ADD CONSTRAINT fk_package_requests_dinner_meal FOREIGN KEY (dinner_meal_id) REFERENCES meals(id);
