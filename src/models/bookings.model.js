import { pool } from '../db/pool.js';

export async function findBookingById(id) {
  const { rows } = await pool.query('SELECT * FROM bookings WHERE id = ?', [id]);
  return rows[0] || null;
}

// Idempotency check for the FIT/MICE quote-to-booking conversion
// (booking.service.js#createBookingFromPackageRequest) — bookings.source_id
// isn't unique on its own (an fd_package can have many bookings, one per
// departure/agency), but a package_request or mice_rfq can only ever be
// accepted once (respondToPackageRequest/respondToMiceRfq's own
// WHERE status='published' guard), so exactly one bookings row should ever
// exist per (source_type, source_id) for those two source types.
export async function findBookingBySource(sourceType, sourceId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE source_type = ? AND source_id = ? LIMIT 1',
    [sourceType, sourceId]
  );
  return rows[0] || null;
}

export async function listAgencyBookings(agencyId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE agency_id = ? ORDER BY created_at DESC',
    [agencyId]
  );
  return rows;
}

export async function updateBookingStatus(id, status, extra = {}) {
  const setClauses = ['status = ?', 'updated_at = now()'];
  const values = [status];

  if (extra.depositPaid !== undefined) {
    setClauses.push(`deposit_paid = ?`);
    values.push(extra.depositPaid);
  }

  values.push(id);
  await pool.query(
    `UPDATE bookings SET ${setClauses.join(', ')} WHERE id = ?`,
    values
  );
  const { rows } = await pool.query('SELECT * FROM bookings WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function listBookingTravelers(bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_travelers WHERE booking_id = ?', [bookingId]);
  return rows;
}
