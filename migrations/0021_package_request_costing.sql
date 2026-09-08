ALTER TABLE package_requests
  ADD COLUMN internal_notes TEXT,
  ADD COLUMN published_at DATETIME,
  ADD COLUMN published_by_user_id CHAR(36);
ALTER TABLE package_requests ADD CONSTRAINT fk_package_requests_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id);

CREATE TABLE audit_logs (
  id CHAR(36) PRIMARY KEY,
  actor_user_id CHAR(36),
  entity TEXT NOT NULL,
  entity_id CHAR(36) NOT NULL,
  field TEXT,
  old_value JSON,
  new_value JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity(255), entity_id, created_at);
