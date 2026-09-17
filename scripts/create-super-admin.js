require('dotenv/config');

const {
  pool
} = require('../src/db/pool.js');

const {
  newId
} = require('../src/utils/id.js');

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
