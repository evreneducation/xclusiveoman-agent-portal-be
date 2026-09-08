-- payment_status's final value list folds in 0073_payment_lifecycle_status.sql's
-- later ALTER TYPE ... ADD VALUE additions (awaiting_payment/
-- awaiting_confirmation/cancelled) — MySQL enums are inline per-column with
-- no separate ALTER TYPE, so the whole lifecycle is defined once here and
-- 0073 becomes a no-op (see its own comment).
CREATE TABLE payments (
  id CHAR(36) PRIMARY KEY,
  booking_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method ENUM('cashfree', 'neft', 'credit_terms') NOT NULL,
  status ENUM(
    'pending', 'confirmed', 'failed', 'pending_verification',
    'awaiting_payment', 'awaiting_confirmation', 'cancelled'
  ) NOT NULL DEFAULT 'pending',
  cashfree_order_id TEXT,
  cashfree_payment_id TEXT,
  neft_slip_url TEXT,
  neft_reference TEXT,
  verified_by_user_id CHAR(36),
  verified_at DATETIME,
  paid_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_payments_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES users(id)
);

CREATE TABLE transactions (
  id CHAR(36) PRIMARY KEY,
  agency_id CHAR(36) NOT NULL,
  booking_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  invoice_url TEXT,
  voucher_url TEXT,
  email_sent BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_agency FOREIGN KEY (agency_id) REFERENCES agencies(id),
  CONSTRAINT fk_transactions_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_transactions_payment FOREIGN KEY (payment_id) REFERENCES payments(id)
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_transactions_agency ON transactions(agency_id);
CREATE INDEX idx_transactions_booking ON transactions(booking_id);
