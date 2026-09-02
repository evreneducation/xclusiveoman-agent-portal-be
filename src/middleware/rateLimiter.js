import rateLimit from 'express-rate-limit';

// IP-scoped throttle for POST /auth/request-otp. Complements (doesn't
// replace) the per-email cooldown enforced in auth.controller.js itself —
// that one stops a single account's inbox from being flooded; this one
// stops a single client from hammering the endpoint across *many*
// different emails, which matters more now that request-otp reports
// whether an email is registered (auth.controller.js#requestLoginOtp) —
// without this, that response becomes a fast email-enumeration oracle.
// Keyed by IP only (default keyGenerator), so it fires regardless of which
// email is being probed.
export const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true, // sets RateLimit-* response headers
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many code requests from this device. Please try again later.' },
});

// IP-scoped throttle for the admin-console 2FA code checks — the extra
// login step (POST /auth/verify-mfa) and the Security screen's own
// enrol/activate/disable calls. A 6-digit TOTP has a million combinations
// and the mfaToken lives 10 minutes, so without this an attacker who
// cleared the email-OTP step could brute the second factor fast. A little
// rounder than otpRequestLimiter's 10 (a fat-fingered admin retrying setup
// shouldn't lock themselves out in a minute), still far below what a real
// guessing run needs.
export const mfaVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many attempts from this device. Please try again later.' },
});

// IP-scoped throttle for POST /auth/admin-login. A password (per-account
// bcrypt hash now — auth.controller.js#adminLogin, 0084_admin_password.sql)
// never expires the way an OTP code does, so it's a standing brute-force
// target for as long as it stays unchanged — throttled the same way
// otpRequestLimiter throttles the send step above.
export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many sign-in attempts from this device. Please try again later.' },
});
