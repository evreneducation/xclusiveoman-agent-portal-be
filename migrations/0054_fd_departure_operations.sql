-- Admin FD Operations Tracker (Task 12 — Screen 19 / OPS-1..4). Reuses
-- fd_departure_dates and bookings as-is (no changes to either) — this only
-- adds the *operational* state a departure moves through, which has no
-- home on either existing table: booking_status (0007_bookings.sql) is a
-- commercial/payment lifecycle per booking, not an operational one per
-- departure, and a departure can carry bookings from several agencies at
-- once (bookings.fd_departure_date_id is already many-to-one).
--
-- Stage 1 ("Booking Confirmed") is deliberately NOT a column here — it's
-- derived at query time from bookings.status (>=1 booking 'confirmed' or
-- 'fully_paid' for this departure), so there is exactly one place that
-- knows what "booking confirmed" means, matching the project's own
-- "server-authoritative, never a second definition" convention (e.g.
-- Marketing Center's audience segments all resolving through one
-- listAgencies() call).
--
-- One row per fd_departure_date, created lazily (not one per departure up
-- front) the first time an admin opens/acts on its tracker.
CREATE TABLE fd_departure_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_departure_date_id UUID NOT NULL UNIQUE REFERENCES fd_departure_dates(id),
  -- Stages 2-7. Each a nullable "first completed at" timestamp — never
  -- reset once set (see services/fdOperations.service.js#advanceStage's own
  -- atomic "... WHERE column IS NULL" guard) — the same "first time only,
  -- never corrupted by a repeat action" shape Marketing Center's own open/
  -- click tracking (0053_marketing_campaign_recipient_tracking.sql) already
  -- established for this exact kind of state.
  docs_collected_at TIMESTAMPTZ,
  supplier_coordination_at TIMESTAMPTZ,
  visa_processing_at TIMESTAMPTZ,
  -- Set automatically (never via the generic stage-advance endpoint) the
  -- first time a driver dispatch is actually sent — see
  -- fd_departure_driver_dispatches below; there is no path that marks this
  -- stage "done" without a real dispatch record to back it.
  driver_sent_at TIMESTAMPTZ,
  trip_live_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fd_departure_operations_departure ON fd_departure_operations(fd_departure_date_id);

-- Supplier coordination log (OPS-2 / the wireframe's "Supplier coordination"
-- table — Supplier / Item / Status). Its own small table rather than
-- audit_logs: this has real structured fields (supplier_name, item, status)
-- an admin needs to list/scan directly, the same reasoning the project
-- already used for MICE's own mice_supplier_responses table instead of
-- overloading audit_logs there too.
CREATE TYPE fd_departure_supplier_status AS ENUM ('pending', 'confirmed');

CREATE TABLE fd_departure_supplier_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_departure_date_id UUID NOT NULL REFERENCES fd_departure_dates(id),
  supplier_name TEXT NOT NULL,
  item TEXT NOT NULL,
  status fd_departure_supplier_status NOT NULL DEFAULT 'pending',
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fd_departure_supplier_logs_departure ON fd_departure_supplier_logs(fd_departure_date_id);

-- Driver / pickup dispatch (OPS-3). One row per actual dispatch sent to
-- agents — kept even after the first one sets
-- fd_departure_operations.driver_sent_at, so a later resend (driver
-- changed, etc.) still has its own real record and still notifies agencies
-- again, without re-triggering the stage transition a second time.
CREATE TABLE fd_departure_driver_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_departure_date_id UUID NOT NULL REFERENCES fd_departure_dates(id),
  driver_name TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  pickup_details TEXT NOT NULL,
  sent_by_user_id UUID NOT NULL REFERENCES users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fd_departure_driver_dispatches_departure ON fd_departure_driver_dispatches(fd_departure_date_id);

-- Tour update broadcast (OPS-4). Independent of the 7-stage flow — doesn't
-- advance or require any particular stage; an admin can publish one at any
-- point once a departure has real bookings.
CREATE TYPE fd_departure_tour_update_type AS ENUM ('itinerary_change', 'delay', 'general_notice');

CREATE TABLE fd_departure_tour_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_departure_date_id UUID NOT NULL REFERENCES fd_departure_dates(id),
  update_type fd_departure_tour_update_type NOT NULL,
  message TEXT NOT NULL,
  published_by_user_id UUID NOT NULL REFERENCES users(id),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fd_departure_tour_updates_departure ON fd_departure_tour_updates(fd_departure_date_id);
