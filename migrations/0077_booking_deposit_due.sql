ALTER TABLE bookings ADD COLUMN deposit_due DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE bookings SET deposit_due = total_price;
