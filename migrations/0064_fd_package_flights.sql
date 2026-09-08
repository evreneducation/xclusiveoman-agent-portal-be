ALTER TABLE fd_packages
  ADD COLUMN flights_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN onward_flight_id CHAR(36),
  ADD COLUMN return_flight_id CHAR(36);
ALTER TABLE fd_packages ADD CONSTRAINT fk_fd_packages_onward_flight FOREIGN KEY (onward_flight_id) REFERENCES flights(id);
ALTER TABLE fd_packages ADD CONSTRAINT fk_fd_packages_return_flight FOREIGN KEY (return_flight_id) REFERENCES flights(id);

ALTER TABLE fd_addons ADD COLUMN flight_id CHAR(36);
ALTER TABLE fd_addons ADD CONSTRAINT fk_fd_addons_flight FOREIGN KEY (flight_id) REFERENCES flights(id);
ALTER TABLE fd_addons DROP CHECK fd_addons_exactly_one_item;
ALTER TABLE fd_addons ADD CONSTRAINT fd_addons_exactly_one_item CHECK (
  (CASE WHEN activity_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN tour_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN transfer_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN flight_id IS NOT NULL THEN 1 ELSE 0 END) = 1
);
