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

export function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashRawToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
