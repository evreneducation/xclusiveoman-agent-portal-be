-- Passwords removed system-wide — email OTP (0059_login_otps.sql) is now the
-- sole authentication mechanism for every user (agency and staff alike), so
-- no code path ever writes or reads a password again. Destructive
-- (DROP COLUMN, not additive) — deliberate this time, per explicit
-- instruction: no password field anywhere, "neither in the DB column".
-- Every backend write path that used to set password_hash (register,
-- agencies.controller.js#createSubUser, relationshipManagers/salesManagers
-- #create, scripts/create-super-admin.js, scripts/seed.js) was updated in
-- the same change to stop doing so before this migration runs.
ALTER TABLE users DROP COLUMN password_hash;
