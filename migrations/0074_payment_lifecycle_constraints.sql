-- Cashfree payment lifecycle upgrade — DB-level safety nets, ported from
-- Postgres partial unique indexes to their MySQL equivalents.

-- Per-request idempotency key. MySQL's UNIQUE index already treats every
-- NULL as distinct (same as Postgres), so the original "WHERE
-- client_attempt_token IS NOT NULL" filter needs no replacement — a plain
-- unique index behaves identically here.
ALTER TABLE payments ADD COLUMN client_attempt_token CHAR(36);
CREATE UNIQUE INDEX uq_payments_client_attempt_token ON payments (client_attempt_token);

-- The core guarantee: at most ONE non-terminal Cashfree attempt per booking.
-- Unlike the index above, this filter is a real condition (method +
-- specific statuses), not just "exclude NULL" — a plain unique index on
-- booking_id would incorrectly cap every booking (NEFT included, and any
-- booking with a past completed/cancelled Cashfree attempt) at one payment
-- row ever. MySQL has no partial/filtered index, so this is emulated with a
-- generated column that's non-NULL only when the condition holds, then a
-- normal unique index on that column (NULLs excluded from uniqueness the
-- same way as above) — the standard MySQL technique for a conditional
-- unique constraint.
ALTER TABLE payments ADD COLUMN active_cashfree_key CHAR(36)
  GENERATED ALWAYS AS (
    CASE WHEN method = 'cashfree' AND status IN ('pending', 'awaiting_payment', 'awaiting_confirmation')
      THEN booking_id
    END
  ) STORED;
CREATE UNIQUE INDEX one_active_cashfree_payment ON payments (active_cashfree_key);

-- One transaction row per payment — no condition, so a plain unique index
-- is a direct, faithful port.
CREATE UNIQUE INDEX uq_transactions_payment_id ON transactions (payment_id);
