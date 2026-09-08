-- mice_rfq_status's final value list folds in 0026_mice_rfq_agent_lifecycle.sql's
-- later ALTER TYPE ... ADD VALUE additions ('draft' BEFORE 'submitted',
-- 'revision_requested' AFTER 'published') — MySQL enums are inline
-- per-column, so the whole lifecycle is defined once here; 0026 keeps its
-- other (non-enum) ALTER TABLE statements and drops just the enum ones.
CREATE TABLE mice_rfqs (
  id CHAR(36) PRIMARY KEY,
  agency_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  lead_manager_user_id CHAR(36),
  destination TEXT NOT NULL,
  group_size INT NOT NULL,
  event_date_from DATE NOT NULL,
  event_date_to DATE NOT NULL,
  hall_capacity_needed INT,
  seating_style TEXT,
  av_needs TEXT,
  other_requirements TEXT,
  status ENUM(
    'draft', 'submitted', 'rfp_dispatched', 'supplier_responses_pending',
    'supplier_responses_received', 'costed', 'published', 'revision_requested',
    'accepted', 'negotiating', 'declined', 'expired', 'converted'
  ) NOT NULL DEFAULT 'submitted',
  net_cost_total DECIMAL(12,2),
  markup_rule JSON,
  sell_price DECIMAL(12,2),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mice_rfqs_agency FOREIGN KEY (agency_id) REFERENCES agencies(id),
  CONSTRAINT fk_mice_rfqs_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_mice_rfqs_lead_manager FOREIGN KEY (lead_manager_user_id) REFERENCES users(id)
);

CREATE INDEX idx_mice_rfqs_agency ON mice_rfqs(agency_id);
CREATE INDEX idx_mice_rfqs_status ON mice_rfqs(status);

CREATE TABLE mice_rfq_hotels (
  id CHAR(36) PRIMARY KEY,
  mice_rfq_id CHAR(36) NOT NULL,
  hotel_id CHAR(36) NOT NULL,
  CONSTRAINT fk_mice_rfq_hotels_rfq FOREIGN KEY (mice_rfq_id) REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  CONSTRAINT fk_mice_rfq_hotels_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

CREATE TABLE mice_rfq_tours (
  id CHAR(36) PRIMARY KEY,
  mice_rfq_id CHAR(36) NOT NULL,
  tour_id CHAR(36) NOT NULL,
  CONSTRAINT fk_mice_rfq_tours_rfq FOREIGN KEY (mice_rfq_id) REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  CONSTRAINT fk_mice_rfq_tours_tour FOREIGN KEY (tour_id) REFERENCES tours(id)
);

CREATE TABLE mice_rfq_activities (
  id CHAR(36) PRIMARY KEY,
  mice_rfq_id CHAR(36) NOT NULL,
  activity_id CHAR(36) NOT NULL,
  CONSTRAINT fk_mice_rfq_activities_rfq FOREIGN KEY (mice_rfq_id) REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  CONSTRAINT fk_mice_rfq_activities_activity FOREIGN KEY (activity_id) REFERENCES activities(id)
);

CREATE TABLE mice_rfq_transfers (
  id CHAR(36) PRIMARY KEY,
  mice_rfq_id CHAR(36) NOT NULL,
  transfer_id CHAR(36) NOT NULL,
  CONSTRAINT fk_mice_rfq_transfers_rfq FOREIGN KEY (mice_rfq_id) REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  CONSTRAINT fk_mice_rfq_transfers_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id)
);

CREATE INDEX idx_mice_rfq_hotels_rfq ON mice_rfq_hotels(mice_rfq_id);
CREATE INDEX idx_mice_rfq_tours_rfq ON mice_rfq_tours(mice_rfq_id);
CREATE INDEX idx_mice_rfq_activities_rfq ON mice_rfq_activities(mice_rfq_id);
CREATE INDEX idx_mice_rfq_transfers_rfq ON mice_rfq_transfers(mice_rfq_id);
