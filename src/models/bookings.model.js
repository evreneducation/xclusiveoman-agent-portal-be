import { pool } from '../db/pool.js';

export async function findBookingById(id) {
  const { rows } = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listAgencyBookings(agencyId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE agency_id = $1 ORDER BY created_at DESC',
    [agencyId]
  );
  return rows;
}

export async function updateBookingStatus(id, status, extra = {}) {
  const setClauses = ['status = $2', 'updated_at = now()'];
  const values = [id, status];
  let i = 3;

  if (extra.depositPaid !== undefined) {
    setClauses.push(`deposit_paid = $${i}`);
    values.push(extra.depositPaid);
    i += 1;
  }

  const { rows } = await pool.query(
    `UPDATE bookings SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function listBookingTravelers(bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_travelers WHERE booking_id = $1', [bookingId]);
  return rows;
}
