/**
 * Break-glass recovery for the admin console's GLOBAL 2FA toggle
 * (admin/pages/Security.jsx / 0076_admin_2fa.sql). Since there's one shared
 * authenticator secret and no per-user backup codes, a super_admin who
 * loses their authenticator device can't get past the login step *or* the
 * Security screen's disable button (both need a live code). Run this
 * directly against the DB to turn 2FA off and wipe the secret, then set it
 * up again from the Security screen.
 *
 * Usage: node scripts/disable-admin-2fa.js
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

async function main() {
  const { rows } = await pool.query(
    `UPDATE admin_security
       SET totp_enabled = false, totp_secret = NULL, activated_at = NULL, updated_at = now()
     RETURNING id, totp_enabled`
  );

  if (rows[0]) {
    console.log('Admin console 2FA disabled and secret cleared:', rows[0]);
  } else {
    console.log('Nothing to do — no admin_security row exists (2FA was never set up).');
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
