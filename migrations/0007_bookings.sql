CREATE TABLE bookings (
  id CHAR(36) PRIMARY KEY,
  source_type ENUM('fd_package', 'package_request', 'mice_rfq') NOT NULL,
  source_id CHAR(36) NOT NULL,
  fd_departure_date_id CHAR(36),
  agency_id CHAR(36) NOT NULL,
  created_by_user_id CHAR(36) NOT NULL,
  pax INT NOT NULL DEFAULT 1,
  total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  deposit_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_due DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_due_date DATE,
  status ENUM(
    'pending_payment', 'deposit_paid', 'confirmed', 'balance_due',
    'fully_paid', 'amendment_requested', 'cancellation_requested',
    'cancelled', 'completed', 'waitlisted'
  ) NOT NULL DEFAULT 'pending_payment',
  created_via ENUM('self_service', 'manual_admin') NOT NULL DEFAULT 'self_service',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bookings_departure_date FOREIGN KEY (fd_departure_date_id) REFERENCES fd_departure_dates(id),
  CONSTRAINT fk_bookings_agency FOREIGN KEY (agency_id) REFERENCES agencies(id),
  CONSTRAINT fk_bookings_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_bookings_agency ON bookings(agency_id);
CREATE INDEX idx_bookings_source ON bookings(source_type, source_id);

CREATE TABLE booking_travelers (
  id CHAR(36) PRIMARY KEY,
  booking_id CHAR(36) NOT NULL,
  name TEXT NOT NULL,
  passport_no TEXT,
  dob DATE,
  room_share_group TEXT,
  CONSTRAINT fk_booking_travelers_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
);

CREATE TABLE booking_addons (
  id CHAR(36) PRIMARY KEY,
  booking_id CHAR(36) NOT NULL,
  fd_addon_id CHAR(36) NOT NULL,
  price_per_pax DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_booking_addons_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_addons_fd_addon FOREIGN KEY (fd_addon_id) REFERENCES fd_addons(id)
);

CREATE INDEX idx_booking_travelers_booking ON booking_travelers(booking_id);
CREATE INDEX idx_booking_addons_booking ON booking_addons(booking_id);
