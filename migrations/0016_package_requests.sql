-- Custom FIT package requests (doc §11.4, §6.2, FIT-1..FIT-7). This task only
-- implements the agent-side submission half of the flow (blind pricing, no
-- costing/markup/publish yet) — net_cost_breakdown/markup_rule/sell_price are
-- included here for schema fidelity with the doc but are left unused/NULL
-- until the admin costing screens (a separate task) start writing to them.
CREATE TYPE package_request_status AS ENUM (
  'draft', 'submitted', 'costed', 'published', 'accepted',
  'revision_requested', 'declined', 'expired', 'converted'
);

CREATE TABLE package_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  lead_manager_user_id UUID REFERENCES users(id),
  destination TEXT NOT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  pax_adults INT NOT NULL DEFAULT 1,
  pax_children INT NOT NULL DEFAULT 0,
  status package_request_status NOT NULL DEFAULT 'draft',
  net_cost_breakdown JSONB,
  markup_rule JSONB,
  sell_price NUMERIC,
  show_itemized_to_agent BOOLEAN NOT NULL DEFAULT false,
  quote_valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_package_requests_agency ON package_requests(agency_id);
CREATE INDEX idx_package_requests_status ON package_requests(status);

-- city/nights/board_basis mirror the doc's ERD but are left nullable/unset by
-- this task's UI (which only captures a hotel selection, not per-hotel stay
-- details) — the columns exist so a later costing screen can fill them in.
CREATE TABLE package_request_hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_request_id UUID NOT NULL REFERENCES package_requests(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES hotels(id),
  city TEXT,
  nights INT,
  board_basis TEXT
);

CREATE TABLE package_request_tours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_request_id UUID NOT NULL REFERENCES package_requests(id) ON DELETE CASCADE,
  tour_id UUID NOT NULL REFERENCES tours(id),
  day_number INT
);

CREATE TABLE package_request_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_request_id UUID NOT NULL REFERENCES package_requests(id) ON DELETE CASCADE,
  transfer_id UUID NOT NULL REFERENCES transfers(id),
  qty INT
);

-- "Extras" step (FIT-1) — the admin's Activities catalog is the pool of
-- short add-on experiences offered here (mirrors fd_addons' activity_id use).
CREATE TABLE package_request_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_request_id UUID NOT NULL REFERENCES package_requests(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id)
);

-- Mirrors booking_travelers' column shape (name/passport/dob/room share) —
-- kept as its own table rather than reusing booking_travelers since a
-- package request isn't a booking yet (booking_id there is NOT NULL).
CREATE TABLE package_request_travelers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_request_id UUID NOT NULL REFERENCES package_requests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  passport_no TEXT,
  dob DATE,
  room_share_group TEXT
);

CREATE INDEX idx_pr_hotels_request ON package_request_hotels(package_request_id);
CREATE INDEX idx_pr_tours_request ON package_request_tours(package_request_id);
CREATE INDEX idx_pr_transfers_request ON package_request_transfers(package_request_id);
CREATE INDEX idx_pr_activities_request ON package_request_activities(package_request_id);
CREATE INDEX idx_pr_travelers_request ON package_request_travelers(package_request_id);
