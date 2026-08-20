-- Email OTP login. Replaces password-based /auth/login as the actual sign-in
-- gate (password_hash + forgot/reset-password stay in place, untouched —
-- see auth.controller.js's own comment on why). Mirrors
-- password_reset_tokens' own shape (0004_password_reset_tokens.sql) almost
-- exactly — same user_id/hash/expires_at/used_at pattern, new purpose —
-- plus attempt_count, which caps brute-forcing the 6-digit code within its
-- 5-minute window without needing a new rate-limiting dependency.
CREATE TABLE login_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempt_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_login_otps_user_id ON login_otps(user_id);
