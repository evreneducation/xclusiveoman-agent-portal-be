ALTER TABLE hotels ADD COLUMN status ENUM('draft', 'published') NOT NULL DEFAULT 'published';
