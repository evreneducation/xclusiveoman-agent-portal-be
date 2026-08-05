import { pool } from '../db/pool.js';

// Backs the "Location" dropdown on the admin FD Package editor's Departure
// Dates & Inventory panel (fd_departure_dates.location — see migration 0018).
export async function listDepartureLocations() {
  const { rows } = await pool.query('SELECT id, name FROM departure_locations ORDER BY name');
  return rows;
}
