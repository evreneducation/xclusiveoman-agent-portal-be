-- MICE Booking Engine (doc §6.3 / §9.4 / §11.5, MICE-1..MICE-15). This task
-- ("Admin MICE Request Management") only needs somewhere to read submitted
-- requests from and a lead-manager-assignment write path — costing, markup,
-- RFP dispatch/supplier response tracking (mice_supplier_responses), and
-- publishing are a later task, same split as package_requests originally
-- shipped without costing wired up. net_cost_total/markup_rule/sell_price
-- are included now for schema fidelity, left NULL until that task.
--
-- destination isn't in the doc's ERD for mice_rfqs (an FIT-style single
-- free-text field, same shape as package_requests.destination) — added here
-- since the up-to-3-hotels selection doesn't reduce to one place name and
-- this screen's own spec requires a Destination column.
CREATE TYPE mice_rfq_status AS ENUM (
  'submitted', 'rfp_dispatched', 'supplier_responses_pending',
  'supplier_responses_received', 'costed', 'published', 'accepted',
  'negotiating', 'declined', 'expired', 'converted'
);

CREATE TABLE mice_rfqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  lead_manager_user_id UUID REFERENCES users(id),
  destination TEXT NOT NULL,
  group_size INT NOT NULL,
  event_date_from DATE NOT NULL,
  event_date_to DATE NOT NULL,
  hall_capacity_needed INT,
  seating_style TEXT,
  av_needs TEXT,
  other_requirements TEXT,
  status mice_rfq_status NOT NULL DEFAULT 'submitted',
  net_cost_total NUMERIC,
  markup_rule JSONB,
  sell_price NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mice_rfqs_agency ON mice_rfqs(agency_id);
CREATE INDEX idx_mice_rfqs_status ON mice_rfqs(status);

-- Up to 3 hotels (MICE-2/MICE-7) — enforced server-side on write, not by a
-- DB constraint (mirrors package_request_hotels' unbounded shape).
CREATE TABLE mice_rfq_hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mice_rfq_id UUID NOT NULL REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  hotel_id UUID NOT NULL REFERENCES hotels(id)
);

CREATE TABLE mice_rfq_tours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mice_rfq_id UUID NOT NULL REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  tour_id UUID NOT NULL REFERENCES tours(id)
);

CREATE TABLE mice_rfq_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mice_rfq_id UUID NOT NULL REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id)
);

CREATE TABLE mice_rfq_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mice_rfq_id UUID NOT NULL REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  transfer_id UUID NOT NULL REFERENCES transfers(id)
);

CREATE INDEX idx_mice_rfq_hotels_rfq ON mice_rfq_hotels(mice_rfq_id);
CREATE INDEX idx_mice_rfq_tours_rfq ON mice_rfq_tours(mice_rfq_id);
CREATE INDEX idx_mice_rfq_activities_rfq ON mice_rfq_activities(mice_rfq_id);
CREATE INDEX idx_mice_rfq_transfers_rfq ON mice_rfq_transfers(mice_rfq_id);
