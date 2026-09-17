const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function createPayment(
  {
    bookingId,
    amount,
    method,
    status,
    cashfreeOrderId,
    neftSlipUrl,
    neftReference,
    clientAttemptToken,
  }
) {
  // active_cashfree_key (0074_payment_lifecycle_constraints.sql) is a
  // generated column MySQL computes itself from method/status/booking_id —
  // it must never appear in an explicit column/value list here.
  const id = newId();
  await pool.query(
    `INSERT INTO payments (id, booking_id, amount, method, status, cashfree_order_id, neft_slip_url, neft_reference, client_attempt_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      bookingId,
      amount,
      method,
      status,
      cashfreeOrderId || null,
      neftSlipUrl || null,
      neftReference || null,
      clientAttemptToken || null,
    ]
  );
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createPayment = createPayment;

async function findPaymentById(id) {
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.findPaymentById = findPaymentById;

async function findPaymentByCashfreeOrderId(orderId) {
  const { rows } = await pool.query('SELECT * FROM payments WHERE cashfree_order_id = ?', [orderId]);
  return rows[0] || null;
}

module.exports.findPaymentByCashfreeOrderId = findPaymentByCashfreeOrderId;

async function findPaymentByClientAttemptToken(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT * FROM payments WHERE client_attempt_token = ?', [token]);
  return rows[0] || null;
}

module.exports.findPaymentByClientAttemptToken = findPaymentByClientAttemptToken;

async function findActiveCashfreePayment(bookingId) {
  const { rows } = await pool.query(
    `SELECT * FROM payments
     WHERE booking_id = ? AND method = 'cashfree'
       AND status IN ('pending', 'awaiting_payment', 'awaiting_confirmation')
     ORDER BY created_at DESC
     LIMIT 1`,
    [bookingId]
  );
  return rows[0] || null;
}

module.exports.findActiveCashfreePayment = findActiveCashfreePayment;

// --- Lifecycle transitions. Each is guarded so a terminal payment
// (confirmed / failed / cancelled) can never be moved to another state, and
// so NEFT rows (pending_verification) are untouched by the Cashfree
// transitions. Each returns the updated row, or null when the guard blocked
// the change. ---
//
// None of these can reuse "the same WHERE clause" for a follow-up SELECT
// (the pattern used elsewhere in this port for RETURNING-less UPDATEs) —
// every guard here is a condition on the very `status` column the UPDATE
// itself changes, so after a successful transition the row would no longer
// match its own guard (e.g. markPaymentCancelled's `status IN
// (...non-terminal...)` guard is never true once status is actually
// 'cancelled'). So these instead check `rowCount` — src/db/pool.js's adapter
// normalizes mysql2's ResultSetHeader.affectedRows into this same field pg
// used to return, 0 when the WHERE guard blocked the update, >0 when it
// went through.

const NON_TERMINAL = "('pending', 'awaiting_payment', 'awaiting_confirmation')";

async function markPaymentAwaitingPayment(id) {
  const { rowCount } = await pool.query(
    `UPDATE payments SET status = 'awaiting_payment', updated_at = now()
     WHERE id = ? AND status IN ('pending', 'awaiting_payment')`,
    [id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.markPaymentAwaitingPayment = markPaymentAwaitingPayment;

async function markPaymentAwaitingConfirmation(id, { cashfreePaymentId } = {}) {
  const { rowCount } = await pool.query(
    `UPDATE payments
     SET status = 'awaiting_confirmation',
         cashfree_payment_id = COALESCE(?, cashfree_payment_id),
         updated_at = now()
     WHERE id = ? AND status IN ${NON_TERMINAL}`,
    [cashfreePaymentId || null, id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.markPaymentAwaitingConfirmation = markPaymentAwaitingConfirmation;

async function markPaymentCancelled(id) {
  const { rowCount } = await pool.query(
    `UPDATE payments SET status = 'cancelled', updated_at = now()
     WHERE id = ? AND status IN ${NON_TERMINAL}`,
    [id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.markPaymentCancelled = markPaymentCancelled;

async function markPaymentFailed(id) {
  const { rowCount } = await pool.query(
    `UPDATE payments SET status = 'failed', updated_at = now()
     WHERE id = ? AND status IN ${NON_TERMINAL}`,
    [id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.markPaymentFailed = markPaymentFailed;

async function markPaymentConfirmed(id, { cashfreePaymentId, verifiedByUserId } = {}) {
  const { rowCount } = await pool.query(
    `UPDATE payments
     SET status = 'confirmed', paid_at = now(),
         cashfree_payment_id = COALESCE(?, cashfree_payment_id),
         verified_by_user_id = COALESCE(?, verified_by_user_id),
         verified_at = CASE WHEN ? IS NOT NULL THEN now() ELSE verified_at END,
         updated_at = now()
     WHERE id = ? AND status <> 'confirmed'`,
    [cashfreePaymentId || null, verifiedByUserId || null, verifiedByUserId || null, id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.markPaymentConfirmed = markPaymentConfirmed;

async function markPaymentRejected(id, verifiedByUserId) {
  await pool.query(
    `UPDATE payments
     SET status = 'failed', verified_by_user_id = ?, verified_at = now(), updated_at = now()
     WHERE id = ?`,
    [verifiedByUserId, id]
  );
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.markPaymentRejected = markPaymentRejected;

async function listNeftPending() {
  const { rows } = await pool.query(
    `SELECT payments.*, bookings.agency_id, agencies.name AS agency_name
     FROM payments
     JOIN bookings ON bookings.id = payments.booking_id
     JOIN agencies ON agencies.id = bookings.agency_id
     WHERE payments.method = 'neft' AND payments.status = 'pending_verification'
     ORDER BY payments.created_at`
  );
  return rows;
}

module.exports.listNeftPending = listNeftPending;

async function insertTransaction(
  {
    agencyId,
    bookingId,
    paymentId,
    amount,
    method,
    status,
    totalPrice,
    amountPaidToDate,
  }
) {
  const id = newId();
  await pool.query(
    `INSERT INTO transactions (id, agency_id, booking_id, payment_id, amount, method, status, total_price, amount_paid_to_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, agencyId, bookingId, paymentId, amount, method, status, totalPrice, amountPaidToDate]
  );
  const { rows } = await pool.query('SELECT * FROM transactions WHERE id = ?', [id]);
  return rows[0];
}

module.exports.insertTransaction = insertTransaction;

async function listAgencyTransactions(agencyId) {
  const { rows } = await pool.query(
    `SELECT transactions.*, bookings.source_type
     FROM transactions
     JOIN bookings ON bookings.id = transactions.booking_id
     WHERE transactions.agency_id = ?
     ORDER BY transactions.created_at DESC`,
    [agencyId]
  );
  return rows;
}

module.exports.listAgencyTransactions = listAgencyTransactions;

async function listAllTransactions({ method, status, dateFrom } = {}) {
  const clauses = [];
  const values = [];

  if (method) {
    clauses.push(`transactions.method = ?`);
    values.push(method);
  }
  if (status) {
    clauses.push(`transactions.status = ?`);
    values.push(status);
  }
  if (dateFrom) {
    clauses.push(`transactions.created_at >= ?`);
    values.push(dateFrom);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT transactions.*, agencies.name AS agency_name
     FROM transactions
     JOIN agencies ON agencies.id = transactions.agency_id
     ${where}
     ORDER BY transactions.created_at DESC`,
    values
  );
  return rows;
}

module.exports.listAllTransactions = listAllTransactions;
