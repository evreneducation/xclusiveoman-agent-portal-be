-- transactions.status was plain TEXT with no DB-level constraint (0008_payments.sql),
-- unlike payments.status which was already a real ENUM. paymentConfirmation.service.js
-- also used to hardcode every transaction to 'confirmed' regardless of whether the
-- payment left a balance due or settled the booking in full — it now writes
-- 'balance_due' or 'fully_paid' instead (see that file's own comment). 'confirmed' is
-- kept as an allowed value here purely to preserve existing historical rows written
-- before this fix, not because new rows can still produce it.
ALTER TABLE transactions
  MODIFY COLUMN status ENUM('confirmed', 'balance_due', 'fully_paid') NOT NULL;
