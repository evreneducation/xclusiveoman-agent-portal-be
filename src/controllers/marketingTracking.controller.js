const {
  verifyOpenToken,
  verifyClickToken,
  recordOpen,
  recordClick
} = require('../services/marketingTracking.service.js');

// The smallest valid transparent GIF (43 bytes, GIF89a, 1x1, transparent
// color index) — the same bytes virtually every tracking-pixel
// implementation uses. Decoded once at module load, not per request.
const TRANSPARENT_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEKAAAALAAAAAABAAEAAAICTAEAOw==', 'base64');

async function trackOpen(req, res) {
  const parsed = verifyOpenToken(req.params.token);
  if (parsed) {
    try {
      await recordOpen(parsed.recipientId);
    } catch (err) {
      // The pixel response itself never depends on this succeeding — a
      // transient DB hiccup must never surface as a broken image.
      console.error('[marketingTracking] Failed to record open', err);
    }
  }

  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(TRANSPARENT_PIXEL.length),
    // Requirement 12 — discourage any caching layer (the recipient's own
    // mail client, a corporate image proxy, etc.) from serving a cached
    // copy instead of hitting this endpoint again on a later open.
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.status(200).send(TRANSPARENT_PIXEL);
}

module.exports.trackOpen = trackOpen;

async function trackClick(req, res) {
  const parsed = verifyClickToken(req.params.token);
  if (!parsed) {
    return res.status(400).send('This tracking link is invalid or has expired.');
  }

  try {
    await recordClick(parsed.recipientId);
  } catch (err) {
    // Getting the recipient to their real destination must never fail just
    // because analytics-recording did.
    console.error('[marketingTracking] Failed to record click', err);
  }

  res.redirect(302, parsed.url);
}

module.exports.trackClick = trackClick;
