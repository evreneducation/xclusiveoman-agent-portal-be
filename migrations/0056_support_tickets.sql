-- Admin Support & Helpdesk (Task 18 — Screen 27/28, SUP-1..3). Schema per
-- the documentation's own ERD (§11.6/§11.8) verbatim:
--   support_tickets (id, agency_id, created_by_user_id, subject TEXT,
--     priority ENUM(low, normal, high), status ENUM(open, in_progress, resolved),
--     assigned_to_user_id UUID NULL)
--   ticket_messages (id, ticket_id, sender_user_id, message TEXT)
-- `description` is added beyond the ERD's bare listing because SUP-1's own
-- requirement text is explicit ("Subject + description form") — same
-- resolution the Task 14 audit used when a requirement's prose said more
-- than its one-line ERD entry.
CREATE TYPE support_ticket_priority AS ENUM ('low', 'normal', 'high');
CREATE TYPE support_ticket_status AS ENUM ('open', 'in_progress', 'resolved');

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority support_ticket_priority NOT NULL DEFAULT 'normal',
  status support_ticket_status NOT NULL DEFAULT 'open',
  -- Assignment candidates are support-role staff + super_admin only (Task 18
  -- scope decision) — enforced in the controller, not here; this column
  -- accepts any user the same way every other assignment column in this
  -- codebase does (e.g. package_requests.lead_manager_user_id).
  assigned_to_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_tickets_agency ON support_tickets(agency_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_assigned ON support_tickets(assigned_to_user_id);

CREATE TABLE ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);
