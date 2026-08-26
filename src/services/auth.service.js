import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

// No password hashing/verification anywhere anymore — email OTP
// (generateNumericOtp below) is the sole authentication mechanism,
// users.password_hash was dropped (0060_drop_password.sql). bcryptjs is
// still a listed dependency (package.json) but nothing in this backend
// calls it now; left installed rather than uninstalled since removing a
// dependency wasn't asked for.

function baseClaims(user) {
  return {
    sub: user.id,
    role: user.role,
    agencyId: user.agency_id,
  };
}

export function signAccessToken(user) {
  return jwt.sign(baseClaims(user), env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn,
  });
}

export function signRefreshToken(user) {
  return jwt.sign(baseClaims(user), env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshExpiresIn,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwtAccessSecret);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwtRefreshSecret);
}

// Itinerary PDF rendering — a normal access token can't be used here: it's
// long-lived (15m) and grants full API access, which is far more than a
// headless-browser render of one specific itinerary needs. This is a
// separate, narrow-purpose token: very short-lived (2m — a Puppeteer render
// takes seconds, not minutes), carries the one packageRequestId it's allowed
// to read, and is marked with `purpose` so requireAuth (middleware/auth.js)
// explicitly refuses it as a normal Bearer token — a leaked pdf token can
// only ever be replayed against the one read-only itinerary-data endpoint
// that accepts it (requirePdfToken), for the one request it names, within
// its 2-minute window.
const ITINERARY_PDF_TOKEN_PURPOSE = 'itinerary_pdf';
const ITINERARY_PDF_TOKEN_EXPIRES_IN = '2m';

export function signItineraryPdfToken({ userId, packageRequestId }) {
  return jwt.sign(
    { sub: userId, packageRequestId, purpose: ITINERARY_PDF_TOKEN_PURPOSE },
    env.jwtAccessSecret,
    { expiresIn: ITINERARY_PDF_TOKEN_EXPIRES_IN }
  );
}

export function verifyItineraryPdfToken(token) {
  const claims = jwt.verify(token, env.jwtAccessSecret);
  if (claims.purpose !== ITINERARY_PDF_TOKEN_PURPOSE) {
    throw new Error('Not an itinerary PDF token');
  }
  return claims;
}

// Same narrow-purpose-token pattern as signItineraryPdfToken above, for FD
// departure itineraries (DepartureDetail.jsx's "Download Itinerary") instead
// of Custom FIT package_requests — a separate `purpose` string so a leaked
// FD token can't be replayed against the FIT data endpoint or vice versa,
// even though both are scoped the same way otherwise.
const FD_ITINERARY_PDF_TOKEN_PURPOSE = 'fd_itinerary_pdf';
const FD_ITINERARY_PDF_TOKEN_EXPIRES_IN = '2m';

export function signFdItineraryPdfToken({ userId, departureId }) {
  return jwt.sign(
    { sub: userId, departureId, purpose: FD_ITINERARY_PDF_TOKEN_PURPOSE },
    env.jwtAccessSecret,
    { expiresIn: FD_ITINERARY_PDF_TOKEN_EXPIRES_IN }
  );
}

export function verifyFdItineraryPdfToken(token) {
  const claims = jwt.verify(token, env.jwtAccessSecret);
  if (claims.purpose !== FD_ITINERARY_PDF_TOKEN_PURPOSE) {
    throw new Error('Not an FD itinerary PDF token');
  }
  return claims;
}

// Still used by the OTP flow below (hashes the 6-digit code before storing
// it) — generateRawToken (the old forgot-password reset-token generator)
// was removed since nothing calls it anymore.
export function hashRawToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Email OTP login — a 6-digit numeric code, the standard/expected format
// for an emailed sign-in code. crypto.randomInt (not Math.random) for the
// same reason every other token in this file uses the `crypto` module —
// this gates real authentication, not a cosmetic feature. Zero-padded so
// e.g. 42 always reads as "000042", never a variable-length "42" that looks
// broken in the email/UI.
export function generateNumericOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}
