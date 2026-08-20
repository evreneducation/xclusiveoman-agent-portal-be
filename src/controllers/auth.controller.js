import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { createAgency } from '../models/agencies.model.js';
import { createUser, findUserByEmail, findUserById, listStaffByRole, toPublicUser } from '../models/users.model.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRawToken,
  generateNumericOtp,
} from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';
import { buildOtpEmailHtml, buildAgentRegistrationReceivedEmailHtml } from '../services/emailTemplate.service.js';
import { createNotification } from '../services/notification.service.js';

// Email OTP login — the sole authentication mechanism now (no password
// anywhere — users.password_hash was dropped, 0060_drop_password.sql).
// 6-digit code, 5-minute expiry, max 5 verification attempts per code
// (login_otps.attempt_count) before it's rejected outright and a fresh one
// has to be requested.
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

// Rate limiting on *sending* a code (as opposed to OTP_MAX_ATTEMPTS above,
// which limits *guessing* one already sent). Two layers:
//  - middleware/rateLimiter.js's otpRequestLimiter, applied in
//    auth.routes.js, throttles by IP regardless of which email is targeted
//    — the thing that matters most now that this endpoint reports whether
//    an email is registered (see requestLoginOtp below).
//  - OTP_RESEND_COOLDOWN_SECONDS/OTP_MAX_PER_WINDOW below throttle by
//    *account* instead, off the existing login_otps rows — no new table or
//    dependency needed, since every send already inserts one row here.
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_PER_WINDOW = 5;
const OTP_RATE_WINDOW_MINUTES = 15;

const REFRESH_COOKIE_NAME = 'xo_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function refreshCookieOptions() {
  const isProd = env.nodeEnv === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    // 'lax' only rides along on same-site requests (fine for local dev, where
    // the Vite proxy keeps everything same-origin). The deployed frontend
    // calls the API cross-origin (VITE_API_PROXY_TARGET), and browsers never
    // attach a 'lax' cookie to a cross-site fetch/XHR — only 'none' does,
    // which itself requires 'secure'.
    sameSite: isProd ? 'none' : 'lax',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: '/api/auth',
  };
}

function issueTokens(res, user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  return accessToken;
}

// Admin-facing "New Agent Added" notification — fires once a new agency +
// owner has actually been created (see register() below; called after
// COMMIT, never before). Reuses the exact same generic notification
// infrastructure every other module in this app already goes through
// (services/notification.service.js's createNotification — the `notifications`
// table, its `notification:new` socket emit, and the shared NotificationBell
// UI, admin/components/AdminLayout.jsx) — none of that is new here, only this
// call site is. createNotification is single-recipient by design (see its
// own doc comment), so "the admin(s)" means looping it once per admin staff
// member — ops_admin and super_admin specifically (the two roles this app
// otherwise treats as "the Admin", e.g. AdminLayout's "ADMIN" badge and the
// existing queue:new_item live-badge socket event's `role:ops_admin` room —
// not the wider STAFF_ROLES list, which also includes specialist roles like
// finance/support that don't review new agency signups).
//
// Best-effort and never awaited by the response: a notification hiccup must
// never fail (or even delay) the registration itself, which has already
// fully succeeded by the time this runs.
async function notifyAdminsOfNewAgent({ agency, user }) {
  try {
    const [opsAdmins, superAdmins] = await Promise.all([
      listStaffByRole('ops_admin'),
      listStaffByRole('super_admin'),
    ]);
    const admins = [...opsAdmins, ...superAdmins].filter((u) => u.status === 'active');

    await Promise.all(
      admins.map((admin) =>
        createNotification({
          recipientUserId: admin.id,
          recipientRole: admin.role,
          type: 'agent_added',
          title: 'New Agent Added',
          message: `Agent ${user.full_name} has been added successfully.`,
          referenceType: 'agency',
          referenceId: agency.id,
        })
      )
    );
  } catch (err) {
    console.error('Failed to notify admins of new agent registration', agency.id, err);
  }
}

// Acknowledges the new owner's own registration (as opposed to
// notifyAdminsOfNewAgent above, which tells admins about it) — same
// best-effort, post-COMMIT posture: an SMTP hiccup here must never fail (or
// even delay) the registration response.
async function sendAgentRegistrationReceivedEmail({ agency, user }) {
  try {
    const { html, attachments } = buildAgentRegistrationReceivedEmailHtml({
      fullName: user.full_name,
      agencyName: agency.name,
    });
    await sendEmail({
      to: user.email,
      subject: "We've received your Xclusive Oman registration",
      text: `Thanks for registering ${agency.name} with Xclusive Oman. Our team is reviewing your details now — you'll get another email the moment you're approved.`,
      html,
      attachments,
    });
  } catch (err) {
    console.error('Failed to send registration-received email', agency.id, err);
  }
}

// POST /api/auth/register — AUTH-1: public agency + owner signup, status=pending.
// No password collected — the new owner signs in afterward (once approved)
// the same way everyone else does now: email OTP.
export async function register(req, res, next) {
  const { agencyName, agencyType, licenseNumber, country, ownerFullName, email, phone } = req.body;

  const client = await pool.connect();
  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'conflict', message: 'Email already registered' });
    }

    await client.query('BEGIN');
    const agency = await createAgency(client, {
      name: agencyName,
      type: agencyType,
      licenseNumber,
      country,
    });

    const user = await createUser(client, {
      agencyId: agency.id,
      role: 'agency_owner',
      fullName: ownerFullName,
      email,
      phone,
    });
    await client.query('COMMIT');

    // Only ever reached after the agency + owner are durably committed —
    // never fires on a failed/rolled-back registration (see the catch block
    // below, which never calls this).
    await notifyAdminsOfNewAgent({ agency, user });
    await sendAgentRegistrationReceivedEmail({ agency, user });

    res.status(201).json({
      agency: { id: agency.id, name: agency.name, status: agency.status },
      user: toPublicUser(user),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/auth/request-otp — Email OTP login, step 1. Explicitly reports
// whether the email is registered/active (product decision, requested by
// the team — trades the usual anti-enumeration posture for a clearer
// sign-in error message on the login form). Only a real, active user ever
// gets a code generated + emailed.
export async function requestLoginOtp(req, res, next) {
  try {
    const { email } = req.body;
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        error: 'not_registered',
        message: 'This email is not registered. Please sign up first.',
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        error: 'account_inactive',
        message: 'This account is inactive. Please contact support.',
      });
    }

    // Per-account send throttle (see the constants' own comment above) —
    // checked against every past send for this user, used or not, so a
    // rapid string of "Resend code" clicks can't outrun it.
    const { rows: recentSends } = await pool.query(
      `SELECT created_at FROM login_otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [user.id, OTP_MAX_PER_WINDOW]
    );
    const now = Date.now();
    const lastSend = recentSends[0];
    if (lastSend) {
      const secondsSinceLastSend = (now - new Date(lastSend.created_at).getTime()) / 1000;
      if (secondsSinceLastSend < OTP_RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({
          error: 'rate_limited',
          message: `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend)}s before requesting another code.`,
        });
      }
    }
    const windowStart = now - OTP_RATE_WINDOW_MINUTES * 60 * 1000;
    const sentWithinWindow = recentSends.filter((row) => new Date(row.created_at).getTime() > windowStart).length;
    if (sentWithinWindow >= OTP_MAX_PER_WINDOW) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many code requests for this account. Please try again later.',
      });
    }

    const otp = generateNumericOtp();
    const otpHash = hashRawToken(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Supersede any earlier, still-unused code for this user first, so at
    // most one OTP is ever valid at a time — clicking "Resend code" (or
    // re-submitting the email step) can't leave several different codes
    // simultaneously accepted.
    await pool.query('UPDATE login_otps SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    await pool.query(
      `INSERT INTO login_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, otpHash, expiresAt]
    );

    const { html, attachments } = buildOtpEmailHtml({ otp, expiresInMinutes: OTP_EXPIRY_MINUTES });
    await sendEmail({
      to: user.email,
      subject: 'Your Xclusive Oman sign-in code',
      text: `Your Xclusive Oman sign-in code is ${otp}. It expires in ${OTP_EXPIRY_MINUTES} minutes.`,
      html,
      attachments,
    });

    res.json({ message: `A sign-in code has been sent to ${user.email}.` });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/verify-otp — Email OTP login, step 2. Issues the same
// {accessToken, user} shape/issueTokens() call every other sign-in path
// here uses, so nothing downstream of a successful sign-in (LoginModal's
// isStaffUser/hard-navigation, either portal's own AuthProvider bootstrap)
// needed to change.
export async function verifyLoginOtp(req, res, next) {
  try {
    const { email, otp } = req.body;
    const user = await findUserByEmail(email);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'invalid_otp', message: 'Invalid or expired code' });
    }

    const { rows } = await pool.query(
      `SELECT * FROM login_otps
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );
    const record = rows[0];
    if (!record) {
      return res.status(401).json({ error: 'invalid_otp', message: 'Invalid or expired code' });
    }

    if (record.attempt_count >= OTP_MAX_ATTEMPTS) {
      await pool.query('UPDATE login_otps SET used_at = now() WHERE id = $1', [record.id]);
      return res.status(401).json({
        error: 'too_many_attempts',
        message: 'Too many incorrect attempts. Request a new code.',
      });
    }

    const submittedHash = hashRawToken(otp);
    if (submittedHash !== record.otp_hash) {
      await pool.query('UPDATE login_otps SET attempt_count = attempt_count + 1 WHERE id = $1', [record.id]);
      return res.status(401).json({ error: 'invalid_otp', message: 'Incorrect code' });
    }

    await pool.query('UPDATE login_otps SET used_at = now() WHERE id = $1', [record.id]);

    const accessToken = issueTokens(res, user);
    res.json({ accessToken, user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/refresh
export async function refresh(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'unauthorized', message: 'Missing refresh token' });
    }

    const claims = verifyRefreshToken(token);
    const user = await findUserById(claims.sub);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const accessToken = issueTokens(res, user);
    res.json({ accessToken, user: toPublicUser(user) });
  } catch (err) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired refresh token' });
  }
}

// POST /api/auth/logout
export async function logout(req, res) {
  // clearCookie must be called with the same attributes the cookie was set
  // with (sameSite/secure included) or some browsers won't match it to clear.
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  res.status(204).send();
}

// GET /api/auth/me
export async function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}
