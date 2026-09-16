-- Each transaction row records one successful payment, but until now had no
-- record of the booking's total price or how much had been paid in total as
-- of that payment — both had to be re-derived by joining back to the
-- (mutable) bookings row, which drifts as later payments come in. These two
-- columns freeze that context at the time of the transaction, so history
-- stays readable even after the booking moves on:
--   total_price -> the booking's total price at the time of this transaction
--   amount_paid_to_date -> cumulative amount paid on the booking, including
--     this transaction (i.e. what bookings.deposit_paid became right after
--     this payment landed)
-- Backfilled below with a best-effort snapshot from the booking's *current*
-- total_price/deposit_paid — these two columns are for visibility/audit, not
-- a source of truth the app reads back from, so an approximation for
-- pre-existing rows is acceptable.
ALTER TABLE transactions
  ADD COLUMN total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN amount_paid_to_date DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE transactions t
JOIN bookings b ON b.id = t.booking_id
SET t.total_price = b.total_price,
    t.amount_paid_to_date = b.deposit_paid
WHERE t.total_price = 0 AND t.amount_paid_to_date = 0;
