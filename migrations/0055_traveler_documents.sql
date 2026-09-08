CREATE TABLE traveler_documents (
  id CHAR(36) PRIMARY KEY,
  booking_traveler_id CHAR(36) NOT NULL UNIQUE,
  passport_scan_url TEXT,
  passport_photo_url TEXT,
  visa_copy_url TEXT,
  uploaded_by_agent_at DATETIME,
  visa_uploaded_by_admin_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_traveler_documents_traveler FOREIGN KEY (booking_traveler_id) REFERENCES booking_travelers(id) ON DELETE CASCADE
);

CREATE INDEX idx_traveler_documents_traveler ON traveler_documents(booking_traveler_id);

CREATE TABLE booking_vouchers (
  id CHAR(36) PRIMARY KEY,
  booking_id CHAR(36) NOT NULL UNIQUE,
  voucher_url TEXT NOT NULL,
  uploaded_by_user_id CHAR(36),
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_booking_vouchers_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_booking_vouchers_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_booking_vouchers_booking ON booking_vouchers(booking_id);

ALTER TABLE bookings ADD COLUMN documents_notified_at DATETIME;
