const rateLimit = require('express-rate-limit');

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true, // sets RateLimit-* response headers
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many code requests from this device. Please try again later.' },
});

module.exports.otpRequestLimiter = otpRequestLimiter;

const mfaVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many attempts from this device. Please try again later.' },
});

module.exports.mfaVerifyLimiter = mfaVerifyLimiter;

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many sign-in attempts from this device. Please try again later.' },
});

module.exports.adminLoginLimiter = adminLoginLimiter;
