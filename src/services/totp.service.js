const crypto = require('node:crypto');

// RFC 6238 TOTP (Google Authenticator / Authy compatible), implemented on
// Node's built-in `crypto` alone — no `otplib`/`speakeasy` dependency. It's
// a small, fixed algorithm (HMAC-SHA1 over a 30-second counter, dynamic
// truncation to 6 digits) and every other token primitive in this backend
// (auth.service.js) is already hand-built on `crypto` for the same reason:
// this gates real authentication, so the moving parts stay visible here.

const STEP_SECONDS = 30;
const DIGITS = 6;
const RFC4648_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

module.exports.generateSecret = generateSecret;

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += RFC4648_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += RFC4648_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = RFC4648_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secretBuf, counter) {
  const counterBuf = Buffer.alloc(8);
  // Counters won't exceed 2^32 for any realistic clock, so the high word
  // stays zero and writeUInt32BE into the low half is sufficient.
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const digest = crypto.createHmac('sha1', secretBuf).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

function currentTotpStep() {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

module.exports.currentTotpStep = currentTotpStep;

function verifyTotpStep(secret, token, usedThroughStep = -1) {
  if (!secret || !/^\d{6}$/.test(String(token || '').trim())) return null;
  let secretBuf;
  try {
    secretBuf = base32Decode(secret);
  } catch {
    return null;
  }
  const step = currentTotpStep();
  // pg hands BIGINT back as a string — coerce before comparing.
  const used = usedThroughStep == null ? -1 : Number(usedThroughStep);
  if (step <= used) return null;
  const expected = hotp(secretBuf, step);
  const candidate = String(token).trim();
  if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) {
    return step;
  }
  return null;
}

module.exports.verifyTotpStep = verifyTotpStep;

function buildOtpAuthUri({ secret, label, issuer }) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports.buildOtpAuthUri = buildOtpAuthUri;
