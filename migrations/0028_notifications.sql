CREATE TABLE notifications (
  id CHAR(36) PRIMARY KEY,
  recipient_user_id CHAR(36) NOT NULL,
  recipient_role TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_type TEXT,
  reference_id CHAR(36),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id)
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id, created_at DESC);
-- Partial index (WHERE is_read = false) has no MySQL equivalent — a plain
-- composite index on the same columns is functionally equivalent, just
-- without the smaller-index-size optimization the filter gave in Postgres.
CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_user_id, is_read);
