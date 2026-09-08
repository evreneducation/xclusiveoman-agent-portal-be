CREATE TABLE login_otps (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_otps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_login_otps_user_id ON login_otps(user_id);
