import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

// Marketing Center Task 11 — Open & Click Tracking. Reuses the project's
// existing JWT signing mechanism (the `jsonwebtoken` dependency already
// used throughout auth.service.js for access/refresh tokens) rather than
// inventing a new token scheme — just with its own `purpose` claim and a
// secret that's never used for real authentication (config/env.js#
// marketingTrackingSecret), so a tracking token can never be mistaken for,
// or replayed as, a login/session token even if someone tried.
//
// No `expiresIn` on either token: unlike a login session, a tracking link
// embedded in an already-sent email must keep working indefinitely — a
// recipient might open a months-old email.

const OPEN_PURPOSE = 'marketing_open';
const CLICK_PURPOSE = 'marketing_click';

export function signOpenToken(recipientId) {
  return jwt.sign({ purpose: OPEN_PURPOSE, rid: recipientId }, env.marketingTrackingSecret);
}

export function signClickToken(recipientId, destinationUrl) {
  return jwt.sign({ purpose: CLICK_PURPOSE, rid: recipientId, u: destinationUrl }, env.marketingTrackingSecret);
}

// Both verify* functions return null (never throw) on any malformed/
// tampered/wrong-purpose token — callers treat that identically to "no
// such recipient", so an attacker probing either public endpoint learns
// nothing about *why* a token failed (requirement 12/13's "don't leak
// sensitive info" posture).
export function verifyOpenToken(token) {
  try {
    const payload = jwt.verify(token, env.marketingTrackingSecret);
    if (payload.purpose !== OPEN_PURPOSE || !payload.rid) return null;
    return { recipientId: payload.rid };
  } catch {
    return null;
  }
}

// Only ever returns a URL that was itself embedded (by this same backend,
// at send time — see buildClickTrackingUrl below) inside a signature-
// verified token. The destination is never taken from a request query
// param, so this can never become an open-redirect: an attacker cannot
// supply or alter the target URL without invalidating the signature.
export function verifyClickToken(token) {
  try {
    const payload = jwt.verify(token, env.marketingTrackingSecret);
    if (payload.purpose !== CLICK_PURPOSE || !payload.rid || !payload.u) return null;
    return { recipientId: payload.rid, url: payload.u };
  } catch {
    return null;
  }
}

// Absolute URLs, since these are embedded in an email and must resolve for
// any external recipient's mail client, not relative to this app.
export function buildOpenTrackingUrl(recipientId) {
  return `${env.apiBaseUrl}/api/marketing/track/open/${signOpenToken(recipientId)}`;
}

export function buildClickTrackingUrl(recipientId, destinationUrl) {
  return `${env.apiBaseUrl}/api/marketing/track/click/${signClickToken(recipientId, destinationUrl)}`;
}

// Atomic — a single UPDATE, never read-then-write — so concurrent opens/
// clicks from the same recipient (e.g. a mail client that prefetches the
// pixel more than once, or a link clicked twice) can never race each other
// into an incorrect count (requirement 11). `COALESCE(opened_at, now())`
// only ever sets the *_at column the first time it's still NULL; the count
// increments on every call, including the first, so open_count/click_count
// is a true "how many times", not "how many times *after* the first".
// WHERE id = $1 matching zero rows (an unknown/stale recipient id) is a
// harmless no-op, not an error — never thrown, since the pixel/redirect
// response must never depend on this succeeding.
export async function recordOpen(recipientId) {
  await pool.query(
    `UPDATE marketing_campaign_recipients
     SET opened_at = COALESCE(opened_at, now()), open_count = open_count + 1
     WHERE id = $1`,
    [recipientId]
  );
}

export async function recordClick(recipientId) {
  await pool.query(
    `UPDATE marketing_campaign_recipients
     SET clicked_at = COALESCE(clicked_at, now()), click_count = click_count + 1
     WHERE id = $1`,
    [recipientId]
  );
}
