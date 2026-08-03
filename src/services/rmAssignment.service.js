import { pool } from '../db/pool.js';

/**
 * Round-robin Relationship Manager assignment (doc §8.8 REL-1): each newly
 * approved agency gets the next RM in rotation automatically, so admin never
 * has to pick one by hand. There's no separate "next in line" pointer table —
 * the rotation is derived from existing data (how many agencies already have
 * an RM, modulo the active RM count), so it can't drift out of sync with
 * reality on its own.
 */
export async function pickNextRoundRobinRm() {
  const { rows: rms } = await pool.query(
    `SELECT id FROM users WHERE role = 'relationship_manager' AND status = 'active' ORDER BY created_at ASC`
  );
  if (rms.length === 0) return null;

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM agencies WHERE rm_user_id IS NOT NULL`
  );
  const assignedSoFar = rows[0].n;

  return rms[assignedSoFar % rms.length].id;
}
