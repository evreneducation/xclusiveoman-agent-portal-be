CREATE TABLE meals (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  description TEXT,
  lunch_price_per_pax DECIMAL(12,2),
  dinner_price_per_pax DECIMAL(12,2),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
