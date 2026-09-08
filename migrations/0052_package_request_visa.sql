ALTER TABLE package_requests ADD COLUMN visa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE package_requests ADD COLUMN visa_people INT;
