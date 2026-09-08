-- Postgres named ENUM types (agency_type/agency_tier/agency_status) become
-- inline MySQL ENUM(...) column definitions — MySQL has no standalone type,
-- just a column-level list. id is CHAR(36), no DB-side default: the app
-- generates ids itself (src/utils/id.js#newId) before every INSERT.
CREATE TABLE agencies (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  type ENUM('travel_agent', 'mice_company') NOT NULL,
  license_number TEXT,
  country TEXT NOT NULL,
  tier ENUM('gold', 'silver', 'bronze'),
  status ENUM('pending', 'approved', 'rejected', 'suspended') NOT NULL DEFAULT 'pending',
  credit_limit DECIMAL(12,2),
  currency_preference TEXT DEFAULT ('OMR'),
  logo_asset_url TEXT,
  rm_user_id CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agencies_status ON agencies(status);
