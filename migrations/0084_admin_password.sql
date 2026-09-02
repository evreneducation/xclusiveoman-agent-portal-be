-- Admin Console login (auth.controller.js#adminLogin) moves from one shared
-- password (env.ADMIN_LOGIN_PASSWORD, checked against every admin/staff
-- account alike) to a real per-account bcrypt hash — every admin/staff role
-- gets their own password now, not just a door everyone shares the key to.
-- Reintroduces the same column name/shape 0060_drop_password.sql dropped;
-- nullable since Agent/Team accounts never set one (they still sign in via
-- email OTP, requestLoginOtp/verifyLoginOtp) and even admin/staff rows start
-- NULL until scripts/seedAdminPasswords.js backfills them from the current
-- ADMIN_LOGIN_PASSWORD env value.
ALTER TABLE users ADD COLUMN password_hash TEXT;
