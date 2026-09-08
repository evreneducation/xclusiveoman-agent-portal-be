-- TEXT[] array columns become JSON (MySQL has no array type); mysql2
-- auto-parses JSON columns to JS arrays, so read/write call sites don't need
-- special handling beyond that.
CREATE TABLE hotels (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  category INT,
  board_basis_options JSON DEFAULT (JSON_ARRAY()),
  mice_ballroom_capacity INT,
  mice_breakout_rooms INT,
  images JSON DEFAULT (JSON_ARRAY()),
  description TEXT,
  is_mice_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tours (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT,
  duration TEXT,
  images JSON DEFAULT (JSON_ARRAY()),
  group_suitability TEXT,
  rating DECIMAL(2,1) DEFAULT 0,
  review_count INT DEFAULT 0,
  suitable_age_min INT,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activities (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT,
  duration TEXT,
  images JSON DEFAULT (JSON_ARRAY()),
  price_per_pax DECIMAL(12,2),
  rating DECIMAL(2,1) DEFAULT 0,
  review_count INT DEFAULT 0,
  suitable_age_min INT,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transfers (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  type ENUM('airport', 'intercity', 'point_to_point', 'group_coach') NOT NULL,
  vehicle_class TEXT,
  city TEXT,
  description TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE experiences (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  images JSON DEFAULT (JSON_ARRAY()),
  suitable_group_size_min INT,
  suitable_group_size_max INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
