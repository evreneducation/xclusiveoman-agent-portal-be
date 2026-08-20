-- Hotel occupancy-tiered pricing: single/double/triple room rate per night,
-- replacing the single flat price_per_night as what the admin actually
-- enters in the Hotel catalog form (HotelEditor.jsx) — admin checks which
-- occupancy types this hotel offers and prices each one independently.
--
-- price_per_night itself is left in place, untouched at the DB level —
-- MICE quote costing (miceRfqsAdmin.controller.js) still reads it as-is and
-- was explicitly out of scope for this change. Rather than migrating that
-- flow too, price_per_night is now derived server-side on every hotel
-- create/update from whichever occupancy price was actually set (priority
-- double -> single -> triple, the same "2 adults per room" baseline this
-- app already assumed everywhere before occupancy-tiered pricing existed —
-- see src/utils/occupancy.js), so MICE costing keeps working unchanged.
-- FD packages (fdPackages.model.js) and the admin's Custom FIT quote
-- costing (packageRequestsAdmin.controller.js) read the three new columns
-- directly instead.
ALTER TABLE hotels ADD COLUMN single_price NUMERIC;
ALTER TABLE hotels ADD COLUMN double_price NUMERIC;
ALTER TABLE hotels ADD COLUMN triple_price NUMERIC;
