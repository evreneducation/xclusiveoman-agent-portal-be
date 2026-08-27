-- Cashfree payment lifecycle upgrade — new payment_status values.
--
-- Kept in its own migration (separate from 0074's indexes) because Postgres
-- will not let a newly ADDed enum value be *used* in the same transaction it
-- was created in — and the migrate runner (src/db/migrate.js) wraps each file
-- in one BEGIN/COMMIT. 0074's partial index references these values, so they
-- must be committed first. Requires PostgreSQL 12+ (ADD VALUE inside a
-- transaction block); every deployed environment is on 15+.
--
-- New states (see also src/services/paymentConfirmation.service.js and
-- src/controllers/payments.controller.js):
--   awaiting_payment      -> checkout session handed to Cashfree
--   awaiting_confirmation -> Cashfree reports paid, final confirmation pending
--   cancelled             -> terminal: superseded / user-dropped / expired
-- 'pending', 'confirmed', 'failed', 'pending_verification' already exist.

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'awaiting_payment';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'awaiting_confirmation';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'cancelled';
