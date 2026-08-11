import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const SALT_ROUNDS = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

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

export function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashRawToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
