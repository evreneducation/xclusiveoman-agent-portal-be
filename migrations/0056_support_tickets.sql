CREATE TABLE support_tickets (
  id CHAR(36) PRIMARY KEY,
  agency_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority ENUM('low', 'normal', 'high') NOT NULL DEFAULT 'normal',
  status ENUM('open', 'in_progress', 'resolved') NOT NULL DEFAULT 'open',
  assigned_to_user_id CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_support_tickets_agency FOREIGN KEY (agency_id) REFERENCES agencies(id),
  CONSTRAINT fk_support_tickets_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_support_tickets_assigned FOREIGN KEY (assigned_to_user_id) REFERENCES users(id)
);

CREATE INDEX idx_support_tickets_agency ON support_tickets(agency_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_assigned ON support_tickets(assigned_to_user_id);

CREATE TABLE ticket_messages (
  id CHAR(36) PRIMARY KEY,
  ticket_id CHAR(36) NOT NULL,
  sender_user_id CHAR(36) NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_messages_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users(id)
);

CREATE INDEX idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);
