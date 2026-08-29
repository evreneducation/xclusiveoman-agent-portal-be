import { pool } from '../db/pool.js';

// Admin console 2FA settings — a singleton row (0076_admin_2fa.sql), the
// same "one row, get-or-create then patch it" shape siteTerms.model.js uses
// for site-wide policy content. One shared TOTP secret guards every
// admin-console sign-in ("global toggle", not per-user enrolment).
export const adminSecurityModel = {
  async get() {
    const { rows } = await pool.query('SELECT * FROM admin_security ORDER BY created_at ASC LIMIT 1');
    return rows[0] || null;
  },

  async ensureRow() {
    const existing = await this.get();
    if (existing) return existing;
    const { rows } = await pool.query('INSERT INTO admin_security DEFAULT VALUES RETURNING *');
    return rows[0];
  },

  // Stashes a freshly generated secret while enrolment is in progress.
  // totp_enabled stays false — the login flow must not start demanding
  // codes until activate() confirms the secret was actually scanned.
  async setPendingSecret(secret) {
    const row = await this.ensureRow();
    const { rows } = await pool.query(
      'UPDATE admin_security SET totp_secret = $1, totp_enabled = false, activated_at = NULL, updated_at = now() WHERE id = $2 RETURNING *',
      [secret, row.id]
    );
    return rows[0];
  },

  // `step` is the time-step counter of the code that confirmed setup — it's
  // recorded as spent so that exact code can't be replayed at the login
  // screen moments later.
  async activate(step) {
    const row = await this.ensureRow();
    const { rows } = await pool.query(
      'UPDATE admin_security SET totp_enabled = true, last_totp_step = $2, activated_at = now(), updated_at = now() WHERE id = $1 RETURNING *',
      [row.id, step]
    );
    return rows[0];
  },

  // Marks a freshly accepted code's window as consumed — conditionally, so
  // two logins racing with the same on-screen code can't both win: only the
  // first UPDATE moves last_totp_step forward, the second matches no row.
  // Returns true if this call is the one that claimed the step.
  async recordUsedStep(step) {
    const row = await this.get();
    if (!row) return false;
    const { rowCount } = await pool.query(
      'UPDATE admin_security SET last_totp_step = $2, updated_at = now() WHERE id = $1 AND (last_totp_step IS NULL OR last_totp_step < $2)',
      [row.id, step]
    );
    return rowCount > 0;
  },

  // Wipes the secret too, not just the flag — a disabled-then-re-enabled
  // setup should force a fresh QR scan rather than silently reactivating a
  // secret someone may have removed from their phone.
  async disable() {
    const row = await this.ensureRow();
    const { rows } = await pool.query(
      'UPDATE admin_security SET totp_enabled = false, totp_secret = NULL, activated_at = NULL, updated_at = now() WHERE id = $1 RETURNING *',
      [row.id]
    );
    return rows[0];
  },
};
