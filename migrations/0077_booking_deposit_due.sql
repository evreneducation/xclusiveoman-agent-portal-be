-- Part-payment at booking time for FD departures (DepartureDetail.jsx ->
-- Payment.jsx). Until now the first payment an agent made was always the
-- whole booking value (balance_due == total_price at creation). New policy:
--
--   * departure < 15 days away  -> full payment is due now
--   * departure >= 15 days away -> a fixed 5,000 deposit is due now, the
--                                  rest (balance_due) stays outstanding and
--                                  is collected later
--
-- `deposit_due` is that "must be paid now to hold the seat" figure, fixed at
-- booking time (booking.service.js#computeFdDepositDue). It's distinct from
-- `balance_due`, which stays the total still owed; "amount due now" the
-- payment screen shows is deposit_due - deposit_paid.
ALTER TABLE bookings ADD COLUMN deposit_due NUMERIC NOT NULL DEFAULT 0;

-- Every existing booking behaved as "the full amount is due now", so keep
-- that true for them rather than retroactively granting a deposit option.
UPDATE bookings SET deposit_due = total_price;
