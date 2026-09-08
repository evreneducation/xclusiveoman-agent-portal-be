-- user_role was a Postgres ENUM here originally, widened by 0009/0010
-- (ALTER TYPE ... ADD VALUE) and eventually converted to plain TEXT by
-- 0069_users_role_text.sql (an admin can type an arbitrary custom role).
-- Folding that whole lifecycle: role is just VARCHAR from creation — 0009,
-- 0010 and 0069 become no-op files (see their own comments).
CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  agency_id CHAR(36),
  role VARCHAR(100) NOT NULL,
  permissions JSON NOT NULL DEFAULT (JSON_OBJECT()),
  full_name TEXT NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone TEXT,
  whatsapp_number TEXT,
  password_hash TEXT NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_agency FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE CASCADE
);

CREATE INDEX idx_users_agency_id ON users(agency_id);
CREATE INDEX idx_users_role ON users(role);

ALTER TABLE agencies
  ADD CONSTRAINT fk_agencies_rm_user FOREIGN KEY (rm_user_id) REFERENCES users(id);
