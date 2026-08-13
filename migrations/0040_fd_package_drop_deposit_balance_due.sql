-- Per-package deposit amount / balance-due-days-before are no longer
-- editable on the FD package (admin's Pricing & payment terms card dropped
-- both fields alongside the earlier tiered-rate removal). Booking-level
-- deposit/balance tracking (bookings.deposit_paid/balance_due/balance_due_date)
-- is untouched — createBooking now falls back to a fixed default lead time
-- instead of a per-package one (see DEFAULT_BALANCE_DUE_DAYS_BEFORE in
-- departures.controller.js).
ALTER TABLE fd_packages DROP COLUMN deposit_amount;
ALTER TABLE fd_packages DROP COLUMN balance_due_days_before;
