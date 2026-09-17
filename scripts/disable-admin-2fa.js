require('dotenv/config');

const {
  pool
} = require('../src/db/pool.js');

async function main() {
  const { rows: existing } = await pool.query('SELECT id FROM admin_security LIMIT 1');
  if (!existing[0]) {
    console.log('Nothing to do — no admin_security row exists (2FA was never set up).');
    await pool.end();
    return;
  }

  await pool.query(
    `UPDATE admin_security
       SET totp_enabled = false, totp_secret = NULL, activated_at = NULL, updated_at = now()
     WHERE id = ?`,
    [existing[0].id]
  );
  const { rows } = await pool.query('SELECT id, totp_enabled FROM admin_security WHERE id = ?', [existing[0].id]);

  console.log('Admin console 2FA disabled and secret cleared:', rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
