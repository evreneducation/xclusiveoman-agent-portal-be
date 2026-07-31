/**
 * One-time bootstrap: inserts the very first super_admin directly, bypassing
 * the API (which requires an existing super_admin to create staff). This is
 * an operational necessity, not demo/seed data.
 *
 * Usage: node scripts/create-super-admin.js <email> <password> "<full name>"
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/services/auth.service.js';

async function main() {
  const [, , email, password, fullName] = process.argv;

  if (!email || !password || !fullName) {
    console.error('Usage: node scripts/create-super-admin.js <email> <password> "<full name>"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const { rows: existingRows } = await pool.query('SELECT id FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  if (existingRows[0]) {
    console.error(`A user with email ${email} already exists.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO users (agency_id, role, full_name, email, password_hash, status)
     VALUES (NULL, 'super_admin', $1, $2, $3, 'active')
     RETURNING id, email, role`,
    [fullName, email.toLowerCase(), passwordHash]
  );

  console.log('Super admin created:', rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
