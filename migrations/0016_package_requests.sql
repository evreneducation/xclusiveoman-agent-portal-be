-- package_request_status's final value list folds in
-- 0017_package_request_assigned_status.sql's later ALTER TYPE ... ADD VALUE
-- 'assigned' AFTER 'submitted' — MySQL enums are inline per-column, so the
-- whole lifecycle is defined once here and 0017 becomes a no-op.
CREATE TABLE package_requests (
  id CHAR(36) PRIMARY KEY,
  agency_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  lead_manager_user_id CHAR(36),
  destination TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  pax_adults INT NOT NULL DEFAULT 1,
  pax_children INT NOT NULL DEFAULT 0,
  status ENUM(
    'draft', 'submitted', 'assigned', 'costed', 'published', 'accepted',
    'revision_requested', 'declined', 'expired', 'converted'
  ) NOT NULL DEFAULT 'draft',
  net_cost_breakdown JSON,
  markup_rule JSON,
  sell_price DECIMAL(12,2),
  show_itemized_to_agent BOOLEAN NOT NULL DEFAULT false,
  quote_valid_until DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_package_requests_agency FOREIGN KEY (agency_id) REFERENCES agencies(id),
  CONSTRAINT fk_package_requests_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_package_requests_lead_manager FOREIGN KEY (lead_manager_user_id) REFERENCES users(id)
);

CREATE INDEX idx_package_requests_agency ON package_requests(agency_id);
CREATE INDEX idx_package_requests_status ON package_requests(status);

CREATE TABLE package_request_hotels (
  id CHAR(36) PRIMARY KEY,
  package_request_id CHAR(36) NOT NULL,
  hotel_id CHAR(36) NOT NULL,
  city TEXT,
  nights INT,
  board_basis TEXT,
  CONSTRAINT fk_pr_hotels_request FOREIGN KEY (package_request_id) REFERENCES package_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_hotels_hotel FOREIGN KEY (hotel_id) REFERENCES hotels(id)
);

CREATE TABLE package_request_tours (
  id CHAR(36) PRIMARY KEY,
  package_request_id CHAR(36) NOT NULL,
  tour_id CHAR(36) NOT NULL,
  day_number INT,
  CONSTRAINT fk_pr_tours_request FOREIGN KEY (package_request_id) REFERENCES package_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_tours_tour FOREIGN KEY (tour_id) REFERENCES tours(id)
);

CREATE TABLE package_request_transfers (
  id CHAR(36) PRIMARY KEY,
  package_request_id CHAR(36) NOT NULL,
  transfer_id CHAR(36) NOT NULL,
  qty INT,
  CONSTRAINT fk_pr_transfers_request FOREIGN KEY (package_request_id) REFERENCES package_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_transfers_transfer FOREIGN KEY (transfer_id) REFERENCES transfers(id)
);

CREATE TABLE package_request_activities (
  id CHAR(36) PRIMARY KEY,
  package_request_id CHAR(36) NOT NULL,
  activity_id CHAR(36) NOT NULL,
  CONSTRAINT fk_pr_activities_request FOREIGN KEY (package_request_id) REFERENCES package_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_pr_activities_activity FOREIGN KEY (activity_id) REFERENCES activities(id)
);

CREATE TABLE package_request_travelers (
  id CHAR(36) PRIMARY KEY,
  package_request_id CHAR(36) NOT NULL,
  name TEXT NOT NULL,
  passport_no TEXT,
  dob DATE,
  room_share_group TEXT,
  CONSTRAINT fk_pr_travelers_request FOREIGN KEY (package_request_id) REFERENCES package_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_pr_hotels_request ON package_request_hotels(package_request_id);
CREATE INDEX idx_pr_tours_request ON package_request_tours(package_request_id);
CREATE INDEX idx_pr_transfers_request ON package_request_transfers(package_request_id);
CREATE INDEX idx_pr_activities_request ON package_request_activities(package_request_id);
CREATE INDEX idx_pr_travelers_request ON package_request_travelers(package_request_id);
