-- Cashfree payment lifecycle upgrade — DB-level safety nets. Depends on the
-- enum values added in 0073 (committed by the time this file runs).

-- Per-request idempotency key. The agent frontend mints one UUID per
-- intentional "Pay" click and replays it on network retry; the backend
-- (createCashfreeOrder) returns the existing attempt instead of creating a
-- second one. Partial index so the many pre-existing NULL rows don't collide.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_attempt_token UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_client_attempt_token
  ON payments (client_attempt_token)
  WHERE client_attempt_token IS NOT NULL;

-- The core guarantee: at most ONE non-terminal Cashfree attempt per booking,
-- enforced by the database so concurrent create-order requests (double-click,
-- Back/Forward, retries) cannot race two live attempts into existence.
-- NEFT rows (method = 'neft') are deliberately exempt.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_cashfree_payment
  ON payments (booking_id)
  WHERE method = 'cashfree'
    AND status IN ('pending', 'awaiting_payment', 'awaiting_confirmation');

-- One transaction row per payment — the safety net against duplicate Cashfree
-- webhook delivery double-crediting a booking (confirmPayment inserts the
-- transaction first and treats a 23505 here as "already processed").
CREATE UNIQUE INDEX IF NOT EXISTS uq_transactions_payment_id
  ON transactions (payment_id);
