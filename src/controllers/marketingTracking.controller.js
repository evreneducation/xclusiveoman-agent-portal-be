import { verifyOpenToken, verifyClickToken, recordOpen, recordClick } from '../services/marketingTracking.service.js';

// The smallest valid transparent GIF (43 bytes, GIF89a, 1x1, transparent
// color index) — the same bytes virtually every tracking-pixel
// implementation uses. Decoded once at module load, not per request.
const TRANSPARENT_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEKAAAALAAAAAABAAEAAAICTAEAOw==', 'base64');

// GET /api/marketing/track/open/:token — Task 11 requirement 1. Public, no
// auth (requirement 16 — the recipient is an external agency contact who
// can never authenticate against this app). Always returns the same 1x1
// pixel with 200, regardless of whether the token was valid: an invalid or
// tampered token silently records nothing rather than erroring, so a
// blocked/stale tracking pixel is never a broken image in the recipient's
// inbox, and probing this endpoint with a bad token teaches an attacker
// nothing (requirement 12's "don't expose sensitive data").
export async function trackOpen(req, res) {
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

// GET /api/marketing/track/click/:token — Task 11 requirements 2/13.
// Public, no auth. The redirect destination is never taken from the
// request (no `?url=` or similar) — only from inside the signed token this
// same backend generated at send time
// (marketingTracking.service.js#signClickToken), so this can never become
// an open-redirect: an attacker cannot supply or alter the target URL
// without invalidating the signature, and an invalid/tampered token simply
// has nothing safe to redirect to.
export async function trackClick(req, res) {
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
