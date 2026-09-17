require('dotenv/config');

const {
  pool
} = require('../src/db/pool.js');

const {
  env
} = require('../src/config/env.js');

const {
  newId
} = require('../src/utils/id.js');

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

  const { rows } = await pool.query('SELECT id FROM users WHERE email = ?', [DEFAULT_EMAIL]);

  if (rows[0]) {
    console.log(`Seed super admin already exists (${DEFAULT_EMAIL}) — skipping.`);
    await pool.end();
    return;
  }

  await pool.query(
    `INSERT INTO users (id, agency_id, role, full_name, email, status)
     VALUES (?, NULL, 'super_admin', ?, ?, 'active')`,
    [newId(), DEFAULT_FULL_NAME, DEFAULT_EMAIL]
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
