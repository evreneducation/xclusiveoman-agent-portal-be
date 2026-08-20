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
