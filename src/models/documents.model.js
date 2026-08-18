import { pool } from '../db/pool.js';

// Admin Client Documents & Visa Processing (Task 14 — Screen 23). Schema per
// migration 0055's own comments — traveler_documents is 1--1 with
// booking_travelers, booking_vouchers is 1--1 with bookings.

// Lazily creates the traveler_documents row the first time anything needs to
// write to it — same "most travelers never get one until someone actually
// uploads something" reasoning as fd_departure_operations' own
// getOrCreateOperations (Task 12). ON CONFLICT DO NOTHING + a follow-up
// SELECT (not a single upsert-and-return) because a concurrent request could
// race the INSERT.
export async function getOrCreateTravelerDocuments(travelerId) {
  await pool.query(
    `INSERT INTO traveler_documents (booking_traveler_id) VALUES ($1)
     ON CONFLICT (booking_traveler_id) DO NOTHING`,
    [travelerId]
  );
  const { rows } = await pool.query('SELECT * FROM traveler_documents WHERE booking_traveler_id = $1', [travelerId]);
  return rows[0];
}

export async function findTravelerDocumentsByTravelerId(travelerId) {
  const { rows } = await pool.query('SELECT * FROM traveler_documents WHERE booking_traveler_id = $1', [travelerId]);
  return rows[0] || null;
}

// DOC-1 — agent uploads passport scan and/or passport-size photo. Either
// field may be omitted (agent can upload one now, the other later); only the
// fields actually provided are overwritten — same "re-upload replaces the
// single current URL" behavior the schema itself only has room for (see
// migration's own comment). uploaded_by_agent_at is touched on every call,
// regardless of which field(s) were provided.
export async function saveAgentDocuments(travelerId, { passportScanUrl, passportPhotoUrl }) {
  await getOrCreateTravelerDocuments(travelerId);
  const { rows } = await pool.query(
    `UPDATE traveler_documents
     SET passport_scan_url = COALESCE($2, passport_scan_url),
         passport_photo_url = COALESCE($3, passport_photo_url),
         uploaded_by_agent_at = now(),
         updated_at = now()
     WHERE booking_traveler_id = $1
     RETURNING *`,
    [travelerId, passportScanUrl || null, passportPhotoUrl || null]
  );
  return rows[0];
}

// DOC-4 — admin uploads the processed visa copy for one traveler.
export async function saveAdminVisaCopy(travelerId, visaCopyUrl) {
  await getOrCreateTravelerDocuments(travelerId);
  const { rows } = await pool.query(
    `UPDATE traveler_documents
     SET visa_copy_url = $2, visa_uploaded_by_admin_at = now(), updated_at = now()
     WHERE booking_traveler_id = $1
     RETURNING *`,
    [travelerId, visaCopyUrl]
  );
  return rows[0];
}

// DOC-5 — admin uploads the booking voucher (booking-level, singular — see
// migration's own comment on why this isn't per-traveler). Upsert: a
// re-upload replaces the one voucher a booking can have, same "current URL
// only, audit_logs keeps the history" posture as traveler_documents.
export async function upsertBookingVoucher(bookingId, { voucherUrl, uploadedByUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO booking_vouchers (booking_id, voucher_url, uploaded_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (booking_id) DO UPDATE
       SET voucher_url = EXCLUDED.voucher_url,
           uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
           uploaded_at = now()
     RETURNING *`,
    [bookingId, voucherUrl, uploadedByUserId || null]
  );
  return rows[0];
}

export async function findVoucherByBookingId(bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_vouchers WHERE booking_id = $1', [bookingId]);
  return rows[0] || null;
}

// Every traveler on a booking, LEFT JOINed with their documents row (most
// travelers won't have one yet) — the one query both the agent's and
// admin's booking-detail screens use to render the "documents per traveler"
// section, so neither can ever show a different picture of the same
// booking's document state.
export async function listTravelersWithDocuments(bookingId) {
  const { rows } = await pool.query(
    `SELECT
       bt.id, bt.booking_id, bt.name, bt.passport_no, bt.dob, bt.room_share_group,
       td.passport_scan_url, td.passport_photo_url, td.visa_copy_url,
       td.uploaded_by_agent_at, td.visa_uploaded_by_admin_at
     FROM booking_travelers bt
     LEFT JOIN traveler_documents td ON td.booking_traveler_id = bt.id
     WHERE bt.booking_id = $1
     ORDER BY bt.name`,
    [bookingId]
  );
  return rows;
}

// A traveler row scoped to one booking — used to verify a :travelerId in a
// URL actually belongs to the :bookingId also in that URL before any
// document write, the same "never trust nested IDs from the frontend
// without checking their relationship" posture the FD Operations Tracker's
// own departureDate-belongs-to-package check uses (Task 12/13).
export async function findTravelerInBooking(travelerId, bookingId) {
  const { rows } = await pool.query('SELECT * FROM booking_travelers WHERE id = $1 AND booking_id = $2', [travelerId, bookingId]);
  return rows[0] || null;
}

// DOC-6 — admin's explicit "Notify Agent" action. COALESCE-style
// first-time-only unlock timestamp (matches fd_departure_operations' own
// stage columns): once set, admin-uploaded documents stay unlocked for this
// booking forever; the *action* of notifying (in-app + email) can still be
// repeated (e.g. admin adds one more traveler's visa later and wants to
// resend), it's just not what re-establishes the unlock — it's already
// established.
export async function markDocumentsNotified(bookingId) {
  const { rows } = await pool.query(
    `UPDATE bookings SET documents_notified_at = COALESCE(documents_notified_at, now()), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [bookingId]
  );
  return rows[0] || null;
}
