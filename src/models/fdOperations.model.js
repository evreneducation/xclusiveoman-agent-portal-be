import { pool } from '../db/pool.js';

// Admin FD Operations Tracker (Task 12 — Screen 19). FD-only by construction
// (requirement I4): every query here filters bookings to
// `source_type = 'fd_package'` — package_request/mice_rfq bookings never
// carry a fd_departure_date_id at all (0007_bookings.sql), so this is
// belt-and-suspenders, not the only thing enforcing scope.

// The 6 explicit stages (2-7) in chronological order — stage 1 ("Booking
// Confirmed") is derived, never stored, see isBookingConfirmed() below.
// 'driver_sent' is never settable through advanceStage() directly (see its
// own comment) but still occupies its real position in the sequence, since
// later stages (trip_live, completed) must wait for it like any other.
export const STAGE_ORDER = ['docs_collected', 'supplier_coordination', 'visa_processing', 'driver_sent', 'trip_live', 'completed'];
const STAGE_COLUMN = {
  docs_collected: 'docs_collected_at',
  supplier_coordination: 'supplier_coordination_at',
  visa_processing: 'visa_processing_at',
  driver_sent: 'driver_sent_at',
  trip_live: 'trip_live_at',
  completed: 'completed_at',
};
// Stages settable via the generic POST .../stage endpoint — everything
// except 'driver_sent', which only ever advances as a side effect of a real
// driver dispatch (markDriverSentStage below).
export const MANUAL_STAGES = STAGE_ORDER.filter((s) => s !== 'driver_sent');

// GET /admin/operations/departures — every FD departure date with at least
// one real (source_type='fd_package') booking; the INNER JOIN to the `bk`
// subquery is what scopes this to "has bookings" (a departure nobody has
// booked has nothing to track). `search` (package title) is applied here in
// SQL; `stage` filtering + pagination happen in the controller after
// computeStageInfo() derives each row's current stage — that derivation
// lives in exactly one place (this file's own computeStageInfo), so a SQL
// CASE expression here could never accidentally define "current stage"
// differently from what the detail endpoint shows for the same departure.
export async function listDeparturesWithOperationsState({ search } = {}) {
  const params = [];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    searchClause = `WHERE fp.title ILIKE $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
       fdd.id AS departure_date_id,
       fdd.date,
       fdd.location,
       fp.id AS fd_package_id,
       fp.title AS package_title,
       bk.pax_total::int AS pax_total,
       bk.agency_count::int AS agency_count,
       bk.booking_confirmed,
       ops.id AS operations_id,
       ops.docs_collected_at,
       ops.supplier_coordination_at,
       ops.visa_processing_at,
       ops.driver_sent_at,
       ops.trip_live_at,
       ops.completed_at
     FROM fd_departure_dates fdd
     JOIN fd_packages fp ON fp.id = fdd.fd_package_id
     JOIN (
       SELECT
         fd_departure_date_id,
         SUM(pax) AS pax_total,
         COUNT(DISTINCT agency_id) AS agency_count,
         BOOL_OR(status IN ('confirmed', 'fully_paid')) AS booking_confirmed
       FROM bookings
       WHERE source_type = 'fd_package' AND fd_departure_date_id IS NOT NULL
       GROUP BY fd_departure_date_id
     ) bk ON bk.fd_departure_date_id = fdd.id
     LEFT JOIN fd_departure_operations ops ON ops.fd_departure_date_id = fdd.id
     ${searchClause}
     ORDER BY fdd.date ASC`,
    params
  );
  return rows;
}

// GET /admin/operations/departures/:departureDateId — same shape as one row
// of the list query above (so both can share one computeStageInfo() call),
// null if the departure doesn't exist or has no real FD bookings — same
// "nothing to track" scoping as the list.
export async function findDepartureWithOperationsState(departureDateId) {
  const { rows } = await pool.query(
    `SELECT
       fdd.id AS departure_date_id,
       fdd.date,
       fdd.location,
       fp.id AS fd_package_id,
       fp.title AS package_title,
       fp.hero_image_url,
       bk.pax_total::int AS pax_total,
       bk.agency_count::int AS agency_count,
       bk.booking_confirmed,
       ops.id AS operations_id,
       ops.docs_collected_at,
       ops.supplier_coordination_at,
       ops.visa_processing_at,
       ops.driver_sent_at,
       ops.trip_live_at,
       ops.completed_at
     FROM fd_departure_dates fdd
     JOIN fd_packages fp ON fp.id = fdd.fd_package_id
     JOIN (
       SELECT
         fd_departure_date_id,
         SUM(pax) AS pax_total,
         COUNT(DISTINCT agency_id) AS agency_count,
         BOOL_OR(status IN ('confirmed', 'fully_paid')) AS booking_confirmed
       FROM bookings
       WHERE source_type = 'fd_package' AND fd_departure_date_id IS NOT NULL
       GROUP BY fd_departure_date_id
     ) bk ON bk.fd_departure_date_id = fdd.id
     LEFT JOIN fd_departure_operations ops ON ops.fd_departure_date_id = fdd.id
     WHERE fdd.id = $1`,
    [departureDateId]
  );
  return rows[0] || null;
}

// The one place "what stage is this departure at" is decided — shared by
// the list (compact) and detail (full stageflow) views, so they can never
// disagree about the same departure. `currentStage` is the first
// not-yet-done stage in order (booking_confirmed counts as stage 0); once
// everything is done it stays 'completed'.
export function computeStageInfo(row) {
  const stages = [
    { key: 'booking_confirmed', label: 'Booking Confirmed', done: !!row.booking_confirmed, at: null },
    { key: 'docs_collected', label: 'Documents Collected', done: !!row.docs_collected_at, at: row.docs_collected_at || null },
    {
      key: 'supplier_coordination',
      label: 'Supplier Coordination',
      done: !!row.supplier_coordination_at,
      at: row.supplier_coordination_at || null,
    },
    { key: 'visa_processing', label: 'Visa Processing', done: !!row.visa_processing_at, at: row.visa_processing_at || null },
    { key: 'driver_sent', label: 'Driver / Pickup Sent', done: !!row.driver_sent_at, at: row.driver_sent_at || null },
    { key: 'trip_live', label: 'Trip Live', done: !!row.trip_live_at, at: row.trip_live_at || null },
    { key: 'completed', label: 'Completed / Review', done: !!row.completed_at, at: row.completed_at || null },
  ];
  const firstIncompleteIndex = stages.findIndex((s) => !s.done);
  const currentStage = firstIncompleteIndex === -1 ? stages[stages.length - 1].key : stages[firstIncompleteIndex].key;
  return { stages, currentStage };
}

export function isBookingConfirmed(row) {
  return !!row.booking_confirmed;
}

// Lazily creates the operations row the first time anything needs to write
// to it (stage advance or driver dispatch) — most departures never get one
// until an admin actually opens their tracker and acts on it.
// ON CONFLICT DO NOTHING + a follow-up SELECT (rather than a single
// upsert-and-return) because a concurrent request could race the INSERT;
// either way this always returns the one real row for this departure.
export async function getOrCreateOperations(departureDateId) {
  await pool.query(
    `INSERT INTO fd_departure_operations (fd_departure_date_id) VALUES ($1)
     ON CONFLICT (fd_departure_date_id) DO NOTHING`,
    [departureDateId]
  );
  const { rows } = await pool.query('SELECT * FROM fd_departure_operations WHERE fd_departure_date_id = $1', [departureDateId]);
  return rows[0];
}

// Atomic, race-safe stage advance — a single UPDATE whose WHERE clause
// encodes both guards at once: the target stage isn't already done, and
// every stage before it (in STAGE_ORDER) already is. Only one of two
// concurrent requests for the same transition can ever succeed; the other
// gets 0 rows back. Returns `{ ok: true, operations }` or
// `{ ok: false, reason }` — the reason is determined by a separate,
// non-authoritative read (below) purely to produce a helpful error message;
// the actual correctness guarantee is the atomic UPDATE itself, not that
// read.
export async function advanceStage(operationsId, stage) {
  const column = STAGE_COLUMN[stage];
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const prereqColumns = STAGE_ORDER.slice(0, stageIndex).map((s) => STAGE_COLUMN[s]);
  const prereqClause = prereqColumns.length ? ` AND ${prereqColumns.map((c) => `${c} IS NOT NULL`).join(' AND ')}` : '';

  const { rows } = await pool.query(
    `UPDATE fd_departure_operations
     SET ${column} = now(), updated_at = now()
     WHERE id = $1 AND ${column} IS NULL${prereqClause}
     RETURNING *`,
    [operationsId]
  );
  if (rows[0]) return { ok: true, operations: rows[0] };

  // Determine why, for the error message only (see comment above).
  const { rows: currentRows } = await pool.query('SELECT * FROM fd_departure_operations WHERE id = $1', [operationsId]);
  const current = currentRows[0];
  if (!current) return { ok: false, reason: 'not_found' };
  if (current[column]) return { ok: false, reason: 'already_complete' };
  const missingPrereq = STAGE_ORDER.slice(0, stageIndex).find((s) => !current[STAGE_COLUMN[s]]);
  return { ok: false, reason: 'prerequisite_incomplete', missingStage: missingPrereq };
}

// Inserts a driver dispatch record and sets driver_sent_at the first time
// only (COALESCE-style — same "first time sets it, repeats are a no-op for
// the timestamp" shape Marketing Center's own open/click tracking uses),
// both in one transaction — so the stage and the dispatch it represents can
// never disagree about whether one exists without the other. Every dispatch
// (including a resend after the stage already advanced) still gets its own
// real row here; only the *stage* transition is one-time.
export async function insertDriverDispatchAndAdvanceStage(departureDateId, operationsId, { driverName, vehicle, pickupDetails, sentByUserId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: dispatchRows } = await client.query(
      `INSERT INTO fd_departure_driver_dispatches (fd_departure_date_id, driver_name, vehicle, pickup_details, sent_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [departureDateId, driverName, vehicle, pickupDetails, sentByUserId]
    );
    const { rows: opsRows } = await client.query(
      `UPDATE fd_departure_operations
       SET driver_sent_at = COALESCE(driver_sent_at, now()), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [operationsId]
    );
    await client.query('COMMIT');
    return { dispatch: dispatchRows[0], operations: opsRows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Pax manifest (requirement: reuse bookings/booking_travelers/agencies/
// users, never duplicate passenger or agency data). Traveler rows expose
// name + room_share_group only — passport_no/dob are deliberately never
// selected here, this screen has no need for them (requirement: don't
// expose sensitive passport/document info unnecessarily).
export async function listPaxManifest(departureDateId) {
  const { rows: bookings } = await pool.query(
    `SELECT
       b.id, b.pax, b.status, b.total_price, b.deposit_paid, b.balance_due, b.created_at,
       a.id AS agency_id, a.name AS agency_name,
       u.full_name AS created_by_name, u.email AS created_by_email
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     JOIN users u ON u.id = b.created_by_user_id
     WHERE b.fd_departure_date_id = $1 AND b.source_type = 'fd_package'
     ORDER BY a.name, b.created_at`,
    [departureDateId]
  );
  if (bookings.length === 0) return [];

  const { rows: travelers } = await pool.query(
    `SELECT booking_id, name, room_share_group FROM booking_travelers WHERE booking_id = ANY($1::uuid[]) ORDER BY name`,
    [bookings.map((b) => b.id)]
  );
  const travelersByBooking = new Map();
  for (const t of travelers) {
    if (!travelersByBooking.has(t.booking_id)) travelersByBooking.set(t.booking_id, []);
    travelersByBooking.get(t.booking_id).push(t);
  }

  return bookings.map((b) => ({ ...b, travelers: travelersByBooking.get(b.id) || [] }));
}

// Distinct agencies with a real booking on this departure — the fan-out
// list for driver-dispatch/tour-update notifications (requirement I5:
// "every agency that has a booking on the departure date", no status
// filter beyond source_type='fd_package').
export async function listDepartureAgencyIds(departureDateId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT agency_id FROM bookings WHERE fd_departure_date_id = $1 AND source_type = 'fd_package'`,
    [departureDateId]
  );
  return rows.map((r) => r.agency_id);
}

// --- Supplier coordination log ---

export async function insertSupplierLog(departureDateId, { supplierName, item, status, createdByUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO fd_departure_supplier_logs (fd_departure_date_id, supplier_name, item, status, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [departureDateId, supplierName, item, status, createdByUserId]
  );
  return rows[0];
}

export async function listSupplierLogs(departureDateId) {
  const { rows } = await pool.query(
    `SELECT l.*, u.full_name AS created_by_name
     FROM fd_departure_supplier_logs l
     JOIN users u ON u.id = l.created_by_user_id
     WHERE l.fd_departure_date_id = $1
     ORDER BY l.created_at DESC`,
    [departureDateId]
  );
  return rows;
}

// --- Driver / pickup dispatch ---
// (insertion itself is insertDriverDispatchAndAdvanceStage, above — kept
// next to advanceStage()/markDriverSentStage's old spot conceptually, but
// physically defined earlier since it needs `pool` in scope for its own
// transaction, same as every other model function here.)

export async function listDriverDispatches(departureDateId) {
  const { rows } = await pool.query(
    `SELECT d.*, u.full_name AS sent_by_name
     FROM fd_departure_driver_dispatches d
     JOIN users u ON u.id = d.sent_by_user_id
     WHERE d.fd_departure_date_id = $1
     ORDER BY d.sent_at DESC`,
    [departureDateId]
  );
  return rows;
}

// --- Tour update broadcast ---

export async function insertTourUpdate(departureDateId, { updateType, message, publishedByUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO fd_departure_tour_updates (fd_departure_date_id, update_type, message, published_by_user_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [departureDateId, updateType, message, publishedByUserId]
  );
  return rows[0];
}

export async function listTourUpdates(departureDateId) {
  const { rows } = await pool.query(
    `SELECT t.*, u.full_name AS published_by_name
     FROM fd_departure_tour_updates t
     JOIN users u ON u.id = t.published_by_user_id
     WHERE t.fd_departure_date_id = $1
     ORDER BY t.published_at DESC`,
    [departureDateId]
  );
  return rows;
}
