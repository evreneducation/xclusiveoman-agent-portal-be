ALTER TABLE package_request_travelers
  ADD COLUMN is_child BOOLEAN NOT NULL DEFAULT false;
