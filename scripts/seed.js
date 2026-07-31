/**
 * Idempotent dev seed: ensures a default super_admin account exists so the
 * admin portal has something to log in with out of the box. Safe to re-run —
 * skips insertion if the account already exists.
 *
 * DEV-ONLY DEFAULTS — change this password before any real deployment.
 * Usage: npm run seed
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/services/auth.service.js';

const DEFAULT_EMAIL = 'admin@xclusiveoman.com';
const DEFAULT_PASSWORD = 'Admin@12345';
const DEFAULT_FULL_NAME = 'Super Admin';

async function main() {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [DEFAULT_EMAIL]);

  if (rows[0]) {
    console.log(`Seed super admin already exists (${DEFAULT_EMAIL}) — skipping.`);
    await pool.end();
    return;
  }

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  await pool.query(
    `INSERT INTO users (agency_id, role, full_name, email, password_hash, status)
     VALUES (NULL, 'super_admin', $1, $2, $3, 'active')`,
    [DEFAULT_FULL_NAME, DEFAULT_EMAIL, passwordHash]
  );

  console.log('Seeded default super admin:');
  console.log(`  email:    ${DEFAULT_EMAIL}`);
  console.log(`  password: ${DEFAULT_PASSWORD}`);
  console.log('This is a DEV-ONLY default — change the password before any real deployment.');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
