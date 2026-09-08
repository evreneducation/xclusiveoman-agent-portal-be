CREATE TABLE fd_packages (
  id CHAR(36) PRIMARY KEY,
  title TEXT NOT NULL,
  theme TEXT,
  duration TEXT,
  hero_image_url TEXT,
  short_description TEXT,
  suitable_age_min INT,
  rating DECIMAL(2,1) DEFAULT 0,
  review_count INT DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
  deposit_amount DECIMAL(12,2),
  balance_due_days_before INT DEFAULT 30,
  rate_gold DECIMAL(12,2),
  rate_silver DECIMAL(12,2),
  rate_bronze DECIMAL(12,2),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fd_itinerary_days (
  id CHAR(36) PRIMARY KEY,
  fd_package_id CHAR(36) NOT NULL,
  day_number INT NOT NULL,
  description TEXT,
  CONSTRAINT fk_fd_itinerary_days_package FOREIGN KEY (fd_package_id) REFERENCES fd_packages(id) ON DELETE CASCADE
);

CREATE TABLE fd_departure_dates (
  id CHAR(36) PRIMARY KEY,
  fd_package_id CHAR(36) NOT NULL,
  date DATE NOT NULL,
  seats_total INT NOT NULL DEFAULT 0,
  seats_booked INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_fd_departure_dates_package FOREIGN KEY (fd_package_id) REFERENCES fd_packages(id) ON DELETE CASCADE
);

-- Named explicitly (fd_addons_check) — later migrations (0062/0064/0075) drop
-- and re-add this constraint by name as the mutually-exclusive item set
-- grows; Postgres auto-generated this same name for the original unnamed
-- CHECK, MySQL doesn't auto-name the same way, so it's pinned here instead.
CREATE TABLE fd_addons (
  id CHAR(36) PRIMARY KEY,
  fd_package_id CHAR(36) NOT NULL,
  activity_id CHAR(36),
  tour_id CHAR(36),
  price_per_pax DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_fd_addons_package FOREIGN KEY (fd_package_id) REFERENCES fd_packages(id) ON DELETE CASCADE,
  CONSTRAINT fk_fd_addons_activity FOREIGN KEY (activity_id) REFERENCES activities(id),
  CONSTRAINT fk_fd_addons_tour FOREIGN KEY (tour_id) REFERENCES tours(id),
  CONSTRAINT fd_addons_check CHECK (
    (activity_id IS NOT NULL AND tour_id IS NULL) OR
    (activity_id IS NULL AND tour_id IS NOT NULL)
  )
);

CREATE INDEX idx_fd_departure_dates_package ON fd_departure_dates(fd_package_id);
CREATE INDEX idx_fd_addons_package ON fd_addons(fd_package_id);
