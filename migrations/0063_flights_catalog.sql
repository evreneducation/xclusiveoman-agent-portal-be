CREATE TABLE flights (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure_date DATE NOT NULL,
  is_flight_onward BOOLEAN NOT NULL DEFAULT true,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX flights_is_flight_onward_idx ON flights (is_flight_onward);
