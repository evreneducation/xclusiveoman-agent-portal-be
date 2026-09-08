ALTER TABLE mice_rfqs
  ADD COLUMN cost_breakdown JSON,
  ADD COLUMN internal_notes TEXT,
  ADD COLUMN published_at DATETIME,
  ADD COLUMN published_by_user_id CHAR(36);
ALTER TABLE mice_rfqs ADD CONSTRAINT fk_mice_rfqs_published_by FOREIGN KEY (published_by_user_id) REFERENCES users(id);
