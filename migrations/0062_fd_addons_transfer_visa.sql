ALTER TABLE fd_addons ADD COLUMN transfer_id CHAR(36);
ALTER TABLE fd_addons ADD CONSTRAINT fk_fd_addons_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id);

-- fd_addons_check is the name pinned explicitly in 0006_fd_packages.sql
-- (Postgres auto-generated that same name for the original unnamed CHECK;
-- MySQL needs it named up front to be droppable by name here).
ALTER TABLE fd_addons DROP CHECK fd_addons_check;
ALTER TABLE fd_addons ADD CONSTRAINT fd_addons_exactly_one_item CHECK (
  (CASE WHEN activity_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN tour_id IS NOT NULL THEN 1 ELSE 0 END +
   CASE WHEN transfer_id IS NOT NULL THEN 1 ELSE 0 END) = 1
);

ALTER TABLE fd_packages ADD COLUMN visa_enabled BOOLEAN NOT NULL DEFAULT false;
