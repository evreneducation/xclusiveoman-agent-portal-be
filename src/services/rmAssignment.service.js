const {
  pool
} = require('../db/pool.js');

async function pickNextRoundRobinRm() {
  const { rows: rms } = await pool.query(
    `SELECT id FROM users WHERE role = 'relationship_manager' AND status = 'active' ORDER BY created_at ASC`
  );
  if (rms.length === 0) return null;

  // Postgres' `count(*)::int` cast dropped — MySQL's COUNT(*) already
  // comes back as a plain number, no cast needed/available.
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS n FROM agencies WHERE rm_user_id IS NOT NULL`
  );
  const assignedSoFar = rows[0].n;

  return rms[assignedSoFar % rms.length].id;
}

module.exports.pickNextRoundRobinRm = pickNextRoundRobinRm;
