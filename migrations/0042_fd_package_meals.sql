ALTER TABLE fd_packages ADD COLUMN lunch_meal_id CHAR(36);
ALTER TABLE fd_packages ADD COLUMN lunch_people INT;
ALTER TABLE fd_packages ADD COLUMN lunch_days INT;
ALTER TABLE fd_packages ADD COLUMN dinner_meal_id CHAR(36);
ALTER TABLE fd_packages ADD COLUMN dinner_people INT;
ALTER TABLE fd_packages ADD COLUMN dinner_days INT;
ALTER TABLE fd_packages ADD CONSTRAINT fk_fd_packages_lunch_meal FOREIGN KEY (lunch_meal_id) REFERENCES meals(id);
ALTER TABLE fd_packages ADD CONSTRAINT fk_fd_packages_dinner_meal FOREIGN KEY (dinner_meal_id) REFERENCES meals(id);
