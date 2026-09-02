/**
 * Idempotent dev seed: ensures a default super_admin account exists so the
 * admin portal has something to log in with out of the box. Safe to re-run —
 * skips insertion if the account already exists.
 *
 * No password set here — run `npm run seed-admin-passwords` afterward to
 * backfill this (and every other admin/staff account with none yet) an
 * initial password from ADMIN_LOGIN_PASSWORD (0084_admin_password.sql).
 *
 * Usage: npm run seed
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';

// Set per-environment via SEED_ADMIN_EMAIL in .env (src/config/env.js) —
// dev points at a real inbox so OTP emails during local testing are actually
// receivable; prod should be set to whichever inbox will run the seed there.
const DEFAULT_EMAIL = env.seedAdminEmail;
const DEFAULT_FULL_NAME = 'Super Admin';

async function main() {
  if (!DEFAULT_EMAIL) {
    console.log('No seed email configured for this environment — set SEED_ADMIN_EMAIL in .env.');
    await pool.end();
    return;
  }

  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [DEFAULT_EMAIL]);

  if (rows[0]) {
    console.log(`Seed super admin already exists (${DEFAULT_EMAIL}) — skipping.`);
    await pool.end();
    return;
  }

  await pool.query(
    `INSERT INTO users (agency_id, role, full_name, email, status)
     VALUES (NULL, 'super_admin', $1, $2, 'active')`,
    [DEFAULT_FULL_NAME, DEFAULT_EMAIL]
  );

  console.log('Seeded default super admin:');
  console.log(`  email: ${DEFAULT_EMAIL}`);
  console.log('Run `npm run seed-admin-passwords` next to give this account an initial password, then sign in at /admin/login.');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
