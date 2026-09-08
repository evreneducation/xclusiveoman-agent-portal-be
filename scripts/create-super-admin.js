/**
 * One-time bootstrap: inserts the very first super_admin directly, bypassing
 * the API (which requires an existing super_admin to create staff). This is
 * an operational necessity, not demo/seed data.
 *
 * No password set here — this account can't sign in at /admin/login until
 * `npm run seed-admin-passwords` backfills it an initial one from
 * ADMIN_LOGIN_PASSWORD (0084_admin_password.sql; that script fills any
 * admin/staff row with a NULL password_hash, this one included).
 *
 * Usage: node scripts/create-super-admin.js <email> "<full name>"
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { newId } from '../src/utils/id.js';

async function main() {
  const [, , email, fullName] = process.argv;

  if (!email || !fullName) {
    console.error('Usage: node scripts/create-super-admin.js <email> "<full name>"');
    process.exit(1);
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE email = ?', [
    email.toLowerCase(),
  ]);
  if (existingRows[0]) {
    console.error(`A user with email ${email} already exists.`);
    process.exit(1);
  }

  const id = newId();
  await pool.query(
    `INSERT INTO users (id, agency_id, role, full_name, email, status)
     VALUES (?, NULL, 'super_admin', ?, ?, 'active')`,
    [id, fullName, email.toLowerCase()]
  );
  const { rows } = await pool.query('SELECT id, email, role FROM users WHERE id = ?', [id]);

  console.log('Super admin created:', rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
