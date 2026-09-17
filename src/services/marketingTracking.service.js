const jwt = require('jsonwebtoken');

const {
  env
} = require('../config/env.js');

const {
  pool
} = require('../db/pool.js');

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

function signOpenToken(recipientId) {
  return jwt.sign({ purpose: OPEN_PURPOSE, rid: recipientId }, env.marketingTrackingSecret);
}

module.exports.signOpenToken = signOpenToken;

function signClickToken(recipientId, destinationUrl) {
  return jwt.sign({ purpose: CLICK_PURPOSE, rid: recipientId, u: destinationUrl }, env.marketingTrackingSecret);
}

module.exports.signClickToken = signClickToken;

function verifyOpenToken(token) {
  try {
    const payload = jwt.verify(token, env.marketingTrackingSecret);
    if (payload.purpose !== OPEN_PURPOSE || !payload.rid) return null;
    return { recipientId: payload.rid };
  } catch {
    return null;
  }
}

module.exports.verifyOpenToken = verifyOpenToken;

function verifyClickToken(token) {
  try {
    const payload = jwt.verify(token, env.marketingTrackingSecret);
    if (payload.purpose !== CLICK_PURPOSE || !payload.rid || !payload.u) return null;
    return { recipientId: payload.rid, url: payload.u };
  } catch {
    return null;
  }
}

module.exports.verifyClickToken = verifyClickToken;

function buildOpenTrackingUrl(recipientId) {
  return `${env.apiBaseUrl}/api/marketing/track/open/${signOpenToken(recipientId)}`;
}

module.exports.buildOpenTrackingUrl = buildOpenTrackingUrl;

function buildClickTrackingUrl(recipientId, destinationUrl) {
  return `${env.apiBaseUrl}/api/marketing/track/click/${signClickToken(recipientId, destinationUrl)}`;
}

module.exports.buildClickTrackingUrl = buildClickTrackingUrl;

async function recordOpen(recipientId) {
  await pool.query(
    `UPDATE marketing_campaign_recipients
     SET opened_at = COALESCE(opened_at, now()), open_count = open_count + 1
     WHERE id = ?`,
    [recipientId]
  );
}

module.exports.recordOpen = recordOpen;

async function recordClick(recipientId) {
  await pool.query(
    `UPDATE marketing_campaign_recipients
     SET clicked_at = COALESCE(clicked_at, now()), click_count = click_count + 1
     WHERE id = ?`,
    [recipientId]
  );
}

module.exports.recordClick = recordClick;
