const {
  pool
} = require('../db/pool.js');

async function findBookingById(id) {
  const { rows } = await pool.query('SELECT * FROM bookings WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.findBookingById = findBookingById;

async function findBookingBySource(sourceType, sourceId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE source_type = ? AND source_id = ? LIMIT 1',
    [sourceType, sourceId]
  );
  return rows[0] || null;
}

module.exports.findBookingBySource = findBookingBySource;

async function listAgencyBookings(agencyId) {
  const { rows } = await pool.query(
    'SELECT * FROM bookings WHERE agency_id = ? ORDER BY created_at DESC',
    [agencyId]
  );
  return rows;
}

module.exports.listAgencyBookings = listAgencyBookings;

async function updateBookingStatus(id, status, extra = {}) {
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

module.exports.updateBookingStatus = updateBookingStatus;

async function listBookingTravelers(bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_travelers WHERE booking_id = ?', [bookingId]);
  return rows;
}

module.exports.listBookingTravelers = listBookingTravelers;
