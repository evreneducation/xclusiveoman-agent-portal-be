const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function getOrCreateTravelerDocuments(travelerId) {
  await pool.query(
    `INSERT IGNORE INTO traveler_documents (id, booking_traveler_id) VALUES (?, ?)`,
    [newId(), travelerId]
  );
  const { rows } = await pool.query('SELECT * FROM traveler_documents WHERE booking_traveler_id = ?', [travelerId]);
  return rows[0];
}

module.exports.getOrCreateTravelerDocuments = getOrCreateTravelerDocuments;

async function findTravelerDocumentsByTravelerId(travelerId) {
  const { rows } = await pool.query('SELECT * FROM traveler_documents WHERE booking_traveler_id = ?', [travelerId]);
  return rows[0] || null;
}

module.exports.findTravelerDocumentsByTravelerId = findTravelerDocumentsByTravelerId;

async function saveAgentDocuments(travelerId, { passportScanUrl, passportPhotoUrl }) {
  await getOrCreateTravelerDocuments(travelerId);
  await pool.query(
    `UPDATE traveler_documents
     SET passport_scan_url = COALESCE(?, passport_scan_url),
         passport_photo_url = COALESCE(?, passport_photo_url),
         uploaded_by_agent_at = now(),
         updated_at = now()
     WHERE booking_traveler_id = ?`,
    [passportScanUrl || null, passportPhotoUrl || null, travelerId]
  );
  const { rows } = await pool.query('SELECT * FROM traveler_documents WHERE booking_traveler_id = ?', [travelerId]);
  return rows[0];
}

module.exports.saveAgentDocuments = saveAgentDocuments;

async function saveAdminVisaCopy(travelerId, visaCopyUrl) {
  await getOrCreateTravelerDocuments(travelerId);
  await pool.query(
    `UPDATE traveler_documents
     SET visa_copy_url = ?, visa_uploaded_by_admin_at = now(), updated_at = now()
     WHERE booking_traveler_id = ?`,
    [visaCopyUrl, travelerId]
  );
  const { rows } = await pool.query('SELECT * FROM traveler_documents WHERE booking_traveler_id = ?', [travelerId]);
  return rows[0];
}

module.exports.saveAdminVisaCopy = saveAdminVisaCopy;

async function upsertBookingVoucher(bookingId, { voucherUrl, uploadedByUserId }) {
  await pool.query(
    `INSERT INTO booking_vouchers (id, booking_id, voucher_url, uploaded_by_user_id)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       voucher_url = VALUES(voucher_url),
       uploaded_by_user_id = VALUES(uploaded_by_user_id),
       uploaded_at = now()`,
    [newId(), bookingId, voucherUrl, uploadedByUserId || null]
  );
  const { rows } = await pool.query('SELECT * FROM booking_vouchers WHERE booking_id = ?', [bookingId]);
  return rows[0];
}

module.exports.upsertBookingVoucher = upsertBookingVoucher;

async function findVoucherByBookingId(bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_vouchers WHERE booking_id = ?', [bookingId]);
  return rows[0] || null;
}

module.exports.findVoucherByBookingId = findVoucherByBookingId;

async function listTravelersWithDocuments(bookingId) {
  const { rows } = await pool.query(
    `SELECT
       bt.id, bt.booking_id, bt.name, bt.passport_no, bt.dob, bt.room_share_group,
       td.passport_scan_url, td.passport_photo_url, td.visa_copy_url,
       td.uploaded_by_agent_at, td.visa_uploaded_by_admin_at
     FROM booking_travelers bt
     LEFT JOIN traveler_documents td ON td.booking_traveler_id = bt.id
     WHERE bt.booking_id = ?
     ORDER BY bt.name`,
    [bookingId]
  );
  return rows;
}

module.exports.listTravelersWithDocuments = listTravelersWithDocuments;

async function findTravelerInBooking(travelerId, bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_travelers WHERE id = ? AND booking_id = ?', [travelerId, bookingId]);
  return rows[0] || null;
}

module.exports.findTravelerInBooking = findTravelerInBooking;

async function markDocumentsNotified(bookingId) {
  const { rows: existing } = await pool.query('SELECT id FROM bookings WHERE id = ?', [bookingId]);
  if (!existing[0]) return null;
  await pool.query(
    `UPDATE bookings SET documents_notified_at = COALESCE(documents_notified_at, now()), updated_at = now()
     WHERE id = ?`,
    [bookingId]
  );
  const { rows } = await pool.query('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  return rows[0] || null;
}

module.exports.markDocumentsNotified = markDocumentsNotified;
