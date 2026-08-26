import { pool } from '../db/pool.js';

// Backs the "Location" dropdown on the admin FD Package editor's Departure
// Dates & Inventory panel (fd_departure_dates.location — see migration 0018).
export async function listDepartureLocations() {
  const { rows } = await pool.query('SELECT id, name FROM departure_locations ORDER BY name');
  return rows;
}

// Lets that same picker add a location that isn't in the original
// admin-seeded 15 (migration 0018) yet. `name` has a UNIQUE constraint —
// ON CONFLICT DO UPDATE (a harmless no-op write) rather than DO NOTHING so
// this still RETURNING-s the existing row when the name already exists
// (case-sensitive exact match, same as the UNIQUE constraint itself);
// DO NOTHING returns no row at all on a conflict, which would leave the
// caller with nothing to hand back to the picker that just "created" it.
export async function createDepartureLocation(name) {
  const { rows } = await pool.query(
    `INSERT INTO departure_locations (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name`,
    [name]
  );
  return rows[0];
}
