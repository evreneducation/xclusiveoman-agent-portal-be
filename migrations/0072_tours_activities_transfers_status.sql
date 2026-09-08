-- catalog_status was a single shared Postgres enum type across all three
-- tables; MySQL has no standalone type, so each column gets its own
-- identical inline ENUM('draft', 'published') list instead.
ALTER TABLE tours ADD COLUMN status ENUM('draft', 'published') NOT NULL DEFAULT 'published';
ALTER TABLE activities ADD COLUMN status ENUM('draft', 'published') NOT NULL DEFAULT 'published';
ALTER TABLE transfers ADD COLUMN status ENUM('draft', 'published') NOT NULL DEFAULT 'published';

ALTER TABLE tours MODIFY COLUMN name TEXT NULL;
ALTER TABLE tours MODIFY COLUMN city TEXT NULL;
ALTER TABLE activities MODIFY COLUMN name TEXT NULL;
ALTER TABLE activities MODIFY COLUMN city TEXT NULL;
ALTER TABLE transfers MODIFY COLUMN name TEXT NULL;
ALTER TABLE transfers MODIFY COLUMN type ENUM('airport', 'intercity', 'point_to_point', 'group_coach') NULL;
