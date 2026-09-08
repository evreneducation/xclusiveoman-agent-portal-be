UPDATE fd_departure_dates SET location = 'Mumbai' WHERE location IS NULL;

ALTER TABLE fd_departure_dates MODIFY COLUMN location TEXT NOT NULL;
