import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { createAgency } from '../models/agencies.model.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  toPublicUser,
  updateUser,
} from '../models/users.model.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateRawToken,
  hashRawToken,
} from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';

const REFRESH_COOKIE_NAME = 'xo_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
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

// POST /api/auth/register — AUTH-1: public agency + owner signup, status=pending.
export async function register(req, res, next) {
  const { agencyName, agencyType, licenseNumber, country, ownerFullName, email, phone, password } =
    req.body;

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

    const passwordHash = await hashPassword(password);
    const user = await createUser(client, {
      agencyId: agency.id,
      role: 'agency_owner',
      fullName: ownerFullName,
      email,
      phone,
      passwordHash,
    });
    await client.query('COMMIT');

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

// POST /api/auth/login
export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await findUserByEmail(email);

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

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
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/auth' });
  res.status(204).send();
}

// POST /api/auth/forgot-password
export async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    const user = await findUserByEmail(email);

    // Always respond the same way whether or not the account exists, to avoid
    // leaking which emails are registered.
    if (user) {
      const rawToken = generateRawToken();
      const tokenHash = hashRawToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expiresAt]
      );

      const resetLink = `${env.agentPortalUrl}/reset-password?token=${rawToken}`;
      await sendEmail({
        to: user.email,
        subject: 'Reset your Xclusive Oman password',
        text: `Reset your password: ${resetLink}\nThis link expires in 1 hour.`,
        html: `<p>Reset your password by clicking the link below (expires in 1 hour):</p><p><a href="${resetLink}">${resetLink}</a></p>`,
      });
    }

    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/reset-password
export async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    const tokenHash = hashRawToken(token);

    const { rows } = await pool.query(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash]
    );
    const record = rows[0];

    if (!record) {
      return res.status(400).json({ error: 'invalid_token', message: 'Token is invalid or expired' });
    }

    const passwordHash = await hashPassword(password);
    await updateUser(record.user_id, { passwordHash });
    await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [
      record.id,
    ]);

    res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    next(err);
  }
}

// GET /api/auth/me
export async function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}
