/**
 * One-off/idempotent backfill for 0084_admin_password.sql — every existing
 * Admin Console account (ops_admin/super_admin/sales_marketing/support/
 * finance — the same ADMIN_CONSOLE_ROLES auth.controller.js#belongsToPortal
 * checks, never Agent/Team) gets a real bcrypt password_hash, seeded from
 * the current ADMIN_LOGIN_PASSWORD env value.
 *
 * Only fills rows where password_hash IS NULL, so re-running this after an
 * admin has already changed their own password (once that exists) leaves
 * theirs untouched — this only ever sets an *initial* password, never resets
 * one that's already been set.
 *
 * Usage: npm run seed-admin-passwords
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';
import { hashPassword } from '../src/services/auth.service.js';

const ADMIN_CONSOLE_ROLES = ['ops_admin', 'super_admin', 'sales_marketing', 'support', 'finance'];

async function main() {
  if (!env.adminLoginPassword) {
    console.log('No ADMIN_LOGIN_PASSWORD set in .env — nothing to seed with.');
    await pool.end();
    return;
  }

  const { rows } = await pool.query(
    `SELECT id, email FROM users
     WHERE agency_id IS NULL AND role = ANY($1::text[]) AND password_hash IS NULL`,
    [ADMIN_CONSOLE_ROLES]
  );

  if (rows.length === 0) {
    console.log('Every admin/staff account already has a password set — nothing to do.');
    await pool.end();
    return;
  }

  const hash = await hashPassword(env.adminLoginPassword);

  for (const user of rows) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    console.log(`  seeded password for ${user.email}`);
  }

  console.log(`Seeded ${rows.length} admin/staff account(s) with the current ADMIN_LOGIN_PASSWORD value.`);
  console.log('Each admin should change this to their own password once that\'s possible.');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
