require('dotenv/config');

const {
  pool
} = require('../src/db/pool.js');

const {
  env
} = require('../src/config/env.js');

const {
  hashPassword
} = require('../src/services/auth.service.js');

const ADMIN_CONSOLE_ROLES = ['ops_admin', 'super_admin', 'sales_marketing', 'support', 'finance'];

async function main() {
  if (!env.adminLoginPassword) {
    console.log('No ADMIN_LOGIN_PASSWORD set in .env — nothing to seed with.');
    await pool.end();
    return;
  }

  const { rows } = await pool.query(
    `SELECT id, email FROM users
     WHERE agency_id IS NULL AND role IN (?) AND password_hash IS NULL`,
    [ADMIN_CONSOLE_ROLES]
  );

  if (rows.length === 0) {
    console.log('Every admin/staff account already has a password set — nothing to do.');
    await pool.end();
    return;
  }

  const hash = await hashPassword(env.adminLoginPassword);

  for (const user of rows) {
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, user.id]);
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
