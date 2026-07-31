CREATE TYPE payment_method AS ENUM ('cashfree', 'neft', 'credit_terms');
CREATE TYPE payment_status AS ENUM ('pending', 'confirmed', 'failed', 'pending_verification');

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  amount NUMERIC NOT NULL,
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  cashfree_order_id TEXT,
  cashfree_payment_id TEXT,
  neft_slip_url TEXT,
  neft_reference TEXT,
  verified_by_user_id UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  invoice_url TEXT,
  voucher_url TEXT,
  email_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_booking ON payments(booking_id);
CREATE INDEX idx_transactions_agency ON transactions(agency_id);
CREATE INDEX idx_transactions_booking ON transactions(booking_id);
