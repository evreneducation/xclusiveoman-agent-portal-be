CREATE TYPE booking_source_type AS ENUM ('fd_package', 'package_request', 'mice_rfq');
-- 'waitlisted' is an addition beyond the doc's documented enum, needed for FGD-11 (waitlist).
CREATE TYPE booking_status AS ENUM (
  'pending_payment', 'deposit_paid', 'confirmed', 'balance_due',
  'fully_paid', 'amendment_requested', 'cancellation_requested',
  'cancelled', 'completed', 'waitlisted'
);
CREATE TYPE booking_created_via AS ENUM ('self_service', 'manual_admin');

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type booking_source_type NOT NULL,
  source_id UUID NOT NULL,
  -- Not in the doc's ERD: needed to know which specific departure date (a package
  -- has many) an FGD booking is against; NULL for package_request/mice_rfq bookings.
  fd_departure_date_id UUID REFERENCES fd_departure_dates(id),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  pax INT NOT NULL DEFAULT 1,
  total_price NUMERIC NOT NULL DEFAULT 0,
  deposit_paid NUMERIC NOT NULL DEFAULT 0,
  balance_due NUMERIC NOT NULL DEFAULT 0,
  balance_due_date DATE,
  status booking_status NOT NULL DEFAULT 'pending_payment',
  created_via booking_created_via NOT NULL DEFAULT 'self_service',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_agency ON bookings(agency_id);
CREATE INDEX idx_bookings_source ON bookings(source_type, source_id);

CREATE TABLE booking_travelers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  passport_no TEXT,
  dob DATE,
  room_share_group TEXT
);

-- Not in the doc's ERD: persists which add-ons (and at what price) a booking
-- included, needed for FGD-6's "priced live into total" to survive past booking time.
CREATE TABLE booking_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  fd_addon_id UUID NOT NULL REFERENCES fd_addons(id),
  price_per_pax NUMERIC NOT NULL
);

CREATE INDEX idx_booking_travelers_booking ON booking_travelers(booking_id);
CREATE INDEX idx_booking_addons_booking ON booking_addons(booking_id);
