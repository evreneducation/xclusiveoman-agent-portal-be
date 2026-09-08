ALTER TABLE package_requests DROP COLUMN inclusions;
ALTER TABLE package_requests ADD COLUMN inclusions TEXT;
ALTER TABLE package_requests ADD COLUMN exclusions TEXT;
