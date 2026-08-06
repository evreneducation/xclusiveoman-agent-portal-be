-- Notification System (Task 1 — infrastructure only, doc §11.8/§12.10/§13).
-- Generic/reusable across every module (FIT, MICE, bookings, payments, …):
-- each row targets one specific user (recipient_user_id, matching the
-- socket room convention user:<id> already wired in sockets/index.js) with
-- recipient_role kept alongside as a denormalized snapshot of that user's
-- role at creation time, so role-wide queries/filters (e.g. "all ops_admin
-- notifications") don't need to join back to users. reference_type/
-- reference_id is the doc's polymorphic related_entity_type/id, renamed to
-- match this task's field list, and deep-links to the source record (quote,
-- booking, departure, …) the same way audit_logs' entity/entity_id does.
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  recipient_role TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs "list my notifications, newest first" and "count my unread" — both
-- always scoped to recipient_user_id, so a single composite index covers
-- GET /notifications, GET /notifications/unread-count and the mark-read
-- writes alike.
CREATE INDEX idx_notifications_recipient ON notifications(recipient_user_id, created_at DESC);
CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_user_id, is_read) WHERE is_read = false;
