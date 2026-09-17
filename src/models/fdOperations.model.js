const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

const STAGE_ORDER = ['docs_collected', 'supplier_coordination', 'visa_processing', 'driver_sent', 'trip_live', 'completed'];
module.exports.STAGE_ORDER = STAGE_ORDER;
const STAGE_COLUMN = {
  docs_collected: 'docs_collected_at',
  supplier_coordination: 'supplier_coordination_at',
  visa_processing: 'visa_processing_at',
  driver_sent: 'driver_sent_at',
  trip_live: 'trip_live_at',
  completed: 'completed_at',
};
const MANUAL_STAGES = STAGE_ORDER.filter((s) => s !== 'driver_sent');
module.exports.MANUAL_STAGES = MANUAL_STAGES;

async function listDeparturesWithOperationsState({ search } = {}) {
  const params = [];
  let searchClause = '';
  if (search) {
    params.push(`%${search}%`);
    searchClause = `WHERE LOWER(fp.title) LIKE LOWER(?)`;
  }

  const { rows } = await pool.query(
    `SELECT
       fdd.id AS departure_date_id,
       fdd.date,
       fdd.location,
       fp.id AS fd_package_id,
       fp.title AS package_title,
       bk.pax_total AS pax_total,
       bk.agency_count AS agency_count,
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
         MAX(status IN ('confirmed', 'balance_due', 'fully_paid')) AS booking_confirmed
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

module.exports.listDeparturesWithOperationsState = listDeparturesWithOperationsState;

async function findDepartureWithOperationsState(departureDateId) {
  const { rows } = await pool.query(
    `SELECT
       fdd.id AS departure_date_id,
       fdd.date,
       fdd.location,
       fp.id AS fd_package_id,
       fp.title AS package_title,
       fp.hero_image_url,
       bk.pax_total AS pax_total,
       bk.agency_count AS agency_count,
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
         MAX(status IN ('confirmed', 'balance_due', 'fully_paid')) AS booking_confirmed
       FROM bookings
       WHERE source_type = 'fd_package' AND fd_departure_date_id IS NOT NULL
       GROUP BY fd_departure_date_id
     ) bk ON bk.fd_departure_date_id = fdd.id
     LEFT JOIN fd_departure_operations ops ON ops.fd_departure_date_id = fdd.id
     WHERE fdd.id = ?`,
    [departureDateId]
  );
  return rows[0] || null;
}

module.exports.findDepartureWithOperationsState = findDepartureWithOperationsState;

function computeStageInfo(row) {
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

module.exports.computeStageInfo = computeStageInfo;

function isBookingConfirmed(row) {
  return !!row.booking_confirmed;
}

module.exports.isBookingConfirmed = isBookingConfirmed;

async function getOrCreateOperations(departureDateId) {
  await pool.query(
    `INSERT IGNORE INTO fd_departure_operations (id, fd_departure_date_id) VALUES (?, ?)`,
    [newId(), departureDateId]
  );
  const { rows } = await pool.query('SELECT * FROM fd_departure_operations WHERE fd_departure_date_id = ?', [departureDateId]);
  return rows[0];
}

module.exports.getOrCreateOperations = getOrCreateOperations;

async function advanceStage(operationsId, stage) {
  const column = STAGE_COLUMN[stage];
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const prereqColumns = STAGE_ORDER.slice(0, stageIndex).map((s) => STAGE_COLUMN[s]);
  const prereqClause = prereqColumns.length ? ` AND ${prereqColumns.map((c) => `${c} IS NOT NULL`).join(' AND ')}` : '';

  // Can't reuse this same WHERE clause for a follow-up SELECT (the pattern
  // used elsewhere in this port for RETURNING-less UPDATEs) — the guard is
  // `${column} IS NULL`, and a successful UPDATE sets that very column to
  // now(), so the row would no longer match its own guard afterwards.
  // Instead check `rowCount` — src/db/pool.js's adapter normalizes mysql2's
  // ResultSetHeader.affectedRows into this same field pg used to return.
  const { rowCount } = await pool.query(
    `UPDATE fd_departure_operations
     SET ${column} = now(), updated_at = now()
     WHERE id = ? AND ${column} IS NULL${prereqClause}`,
    [operationsId]
  );
  if (rowCount) {
    const { rows } = await pool.query('SELECT * FROM fd_departure_operations WHERE id = ?', [operationsId]);
    return { ok: true, operations: rows[0] };
  }

  // Determine why, for the error message only (see comment above).
  const { rows: currentRows } = await pool.query('SELECT * FROM fd_departure_operations WHERE id = ?', [operationsId]);
  const current = currentRows[0];
  if (!current) return { ok: false, reason: 'not_found' };
  if (current[column]) return { ok: false, reason: 'already_complete' };
  const missingPrereq = STAGE_ORDER.slice(0, stageIndex).find((s) => !current[STAGE_COLUMN[s]]);
  return { ok: false, reason: 'prerequisite_incomplete', missingStage: missingPrereq };
}

module.exports.advanceStage = advanceStage;

async function insertDriverDispatchAndAdvanceStage(
  departureDateId,
  operationsId,
  { driverName, vehicle, pickupDetails, sentByUserId }
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dispatchId = newId();
    await client.query(
      `INSERT INTO fd_departure_driver_dispatches (id, fd_departure_date_id, driver_name, vehicle, pickup_details, sent_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [dispatchId, departureDateId, driverName, vehicle, pickupDetails, sentByUserId]
    );
    const { rows: dispatchRows } = await client.query('SELECT * FROM fd_departure_driver_dispatches WHERE id = ?', [dispatchId]);
    await client.query(
      `UPDATE fd_departure_operations
       SET driver_sent_at = COALESCE(driver_sent_at, now()), updated_at = now()
       WHERE id = ?`,
      [operationsId]
    );
    const { rows: opsRows } = await client.query('SELECT * FROM fd_departure_operations WHERE id = ?', [operationsId]);
    await client.query('COMMIT');
    return { dispatch: dispatchRows[0], operations: opsRows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports.insertDriverDispatchAndAdvanceStage = insertDriverDispatchAndAdvanceStage;

async function listPaxManifest(departureDateId) {
  const { rows: bookings } = await pool.query(
    `SELECT
       b.id, b.pax, b.status, b.total_price, b.deposit_paid, b.balance_due, b.created_at,
       a.id AS agency_id, a.name AS agency_name,
       u.full_name AS created_by_name, u.email AS created_by_email
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     JOIN users u ON u.id = b.created_by_user_id
     WHERE b.fd_departure_date_id = ? AND b.source_type = 'fd_package'
     ORDER BY a.name, b.created_at`,
    [departureDateId]
  );
  if (bookings.length === 0) return [];

  const { rows: travelers } = await pool.query(
    `SELECT booking_id, name, room_share_group FROM booking_travelers WHERE booking_id IN (?) ORDER BY name`,
    [bookings.map((b) => b.id)]
  );
  const travelersByBooking = new Map();
  for (const t of travelers) {
    if (!travelersByBooking.has(t.booking_id)) travelersByBooking.set(t.booking_id, []);
    travelersByBooking.get(t.booking_id).push(t);
  }

  return bookings.map((b) => ({ ...b, travelers: travelersByBooking.get(b.id) || [] }));
}

module.exports.listPaxManifest = listPaxManifest;

async function listDepartureAgencyIds(departureDateId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT agency_id FROM bookings WHERE fd_departure_date_id = ? AND source_type = 'fd_package'`,
    [departureDateId]
  );
  return rows.map((r) => r.agency_id);
}

module.exports.listDepartureAgencyIds = listDepartureAgencyIds;

async function insertSupplierLog(departureDateId, { supplierName, item, status, createdByUserId }) {
  const id = newId();
  await pool.query(
    `INSERT INTO fd_departure_supplier_logs (id, fd_departure_date_id, supplier_name, item, status, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, departureDateId, supplierName, item, status, createdByUserId]
  );
  const { rows } = await pool.query('SELECT * FROM fd_departure_supplier_logs WHERE id = ?', [id]);
  return rows[0];
}

module.exports.insertSupplierLog = insertSupplierLog;

async function listSupplierLogs(departureDateId) {
  const { rows } = await pool.query(
    `SELECT l.*, u.full_name AS created_by_name
     FROM fd_departure_supplier_logs l
     JOIN users u ON u.id = l.created_by_user_id
     WHERE l.fd_departure_date_id = ?
     ORDER BY l.created_at DESC`,
    [departureDateId]
  );
  return rows;
}

module.exports.listSupplierLogs = listSupplierLogs;

async function listDriverDispatches(departureDateId) {
  const { rows } = await pool.query(
    `SELECT d.*, u.full_name AS sent_by_name
     FROM fd_departure_driver_dispatches d
     JOIN users u ON u.id = d.sent_by_user_id
     WHERE d.fd_departure_date_id = ?
     ORDER BY d.sent_at DESC`,
    [departureDateId]
  );
  return rows;
}

module.exports.listDriverDispatches = listDriverDispatches;

async function insertTourUpdate(departureDateId, { updateType, message, publishedByUserId }) {
  const id = newId();
  await pool.query(
    `INSERT INTO fd_departure_tour_updates (id, fd_departure_date_id, update_type, message, published_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [id, departureDateId, updateType, message, publishedByUserId]
  );
  const { rows } = await pool.query('SELECT * FROM fd_departure_tour_updates WHERE id = ?', [id]);
  return rows[0];
}

module.exports.insertTourUpdate = insertTourUpdate;

async function listTourUpdates(departureDateId) {
  const { rows } = await pool.query(
    `SELECT t.*, u.full_name AS published_by_name
     FROM fd_departure_tour_updates t
     JOIN users u ON u.id = t.published_by_user_id
     WHERE t.fd_departure_date_id = ?
     ORDER BY t.published_at DESC`,
    [departureDateId]
  );
  return rows;
}

module.exports.listTourUpdates = listTourUpdates;
