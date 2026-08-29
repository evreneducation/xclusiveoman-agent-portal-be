-- Admin console two-factor authentication (Security sidebar screen,
-- admin/pages/Security.jsx). "Authenticator app" / TOTP only, and a single
-- GLOBAL toggle rather than per-user enrolment: one shared TOTP secret
-- guards every admin-console sign-in once it's turned on. Singleton row,
-- same "one row, get-or-create then patch in place" convention
-- site_terms (0067_site_terms.sql) already uses for site-wide settings.
--
--   totp_secret   base32, no padding. Set (pending) the moment enrolment
--                 starts; only trusted for login once totp_enabled flips.
--                 NULLed again on disable so a stale secret can't linger.
--   totp_enabled  false until a valid 6-digit code confirms the secret was
--                 scanned; this is the actual "2FA is on" switch the login
--                 flow (auth.controller.js#verifyLoginOtp) reads.
--   last_totp_step the 30-second time-step counter of the most recently
--                 accepted code. Every check requires the *current* step
--                 (no drift window) AND a step strictly greater than this,
--                 so a code is single-use: once spent, that window — and
--                 every earlier one — is dead, even if it's still on screen.
CREATE TABLE admin_security (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  last_totp_step BIGINT,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
