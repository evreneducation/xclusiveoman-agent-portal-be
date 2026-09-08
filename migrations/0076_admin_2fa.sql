CREATE TABLE admin_security (
  id CHAR(36) PRIMARY KEY,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  last_totp_step BIGINT,
  activated_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
