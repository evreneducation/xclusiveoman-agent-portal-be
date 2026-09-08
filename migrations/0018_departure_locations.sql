-- name is VARCHAR (not TEXT) since it carries a UNIQUE constraint — MySQL/
-- InnoDB requires a bounded key length for indexed columns, unlike Postgres.
CREATE TABLE departure_locations (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE fd_departure_dates ADD COLUMN location TEXT;

-- ON CONFLICT (name) DO NOTHING -> INSERT IGNORE (name's UNIQUE constraint
-- makes a duplicate a silent no-op, same as the original).
INSERT IGNORE INTO departure_locations (id, name) VALUES
  (UUID(), 'Mumbai'),
  (UUID(), 'Delhi'),
  (UUID(), 'Bengaluru'),
  (UUID(), 'Hyderabad'),
  (UUID(), 'Chennai'),
  (UUID(), 'Kolkata'),
  (UUID(), 'Pune'),
  (UUID(), 'Ahmedabad'),
  (UUID(), 'Jaipur'),
  (UUID(), 'Lucknow'),
  (UUID(), 'Kochi'),
  (UUID(), 'Chandigarh'),
  (UUID(), 'Goa'),
  (UUID(), 'Indore'),
  (UUID(), 'Surat');
