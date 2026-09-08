ALTER TABLE fd_itinerary_days RENAME COLUMN description TO notes;

CREATE TABLE fd_itinerary_items (
  id CHAR(36) PRIMARY KEY,
  fd_package_id CHAR(36) NOT NULL,
  day_number INT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('hotel', 'tour', 'transfer', 'activity')),
  item_id CHAR(36) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  note TEXT,
  CONSTRAINT fk_fd_itinerary_items_package FOREIGN KEY (fd_package_id) REFERENCES fd_packages(id) ON DELETE CASCADE
);

CREATE INDEX idx_fd_itinerary_items_package ON fd_itinerary_items(fd_package_id);
CREATE INDEX idx_fd_itinerary_items_day ON fd_itinerary_items(fd_package_id, day_number, position);
