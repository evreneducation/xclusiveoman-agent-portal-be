import { pool } from '../db/pool.js';

export async function createPayment({
  bookingId,
  amount,
  method,
  status,
  cashfreeOrderId,
  neftSlipUrl,
  neftReference,
  clientAttemptToken,
}) {
  const { rows } = await pool.query(
    `INSERT INTO payments (booking_id, amount, method, status, cashfree_order_id, neft_slip_url, neft_reference, client_attempt_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
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
  return rows[0];
}

export async function findPaymentById(id) {
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function findPaymentByCashfreeOrderId(orderId) {
  const { rows } = await pool.query('SELECT * FROM payments WHERE cashfree_order_id = $1', [orderId]);
  return rows[0] || null;
}

export async function findPaymentByClientAttemptToken(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT * FROM payments WHERE client_attempt_token = $1', [token]);
  return rows[0] || null;
}

// The one non-terminal Cashfree attempt for a booking, if any — predicate
// mirrors the `one_active_cashfree_payment` partial unique index exactly.
export async function findActiveCashfreePayment(bookingId) {
  const { rows } = await pool.query(
    `SELECT * FROM payments
     WHERE booking_id = $1 AND method = 'cashfree'
       AND status IN ('pending', 'awaiting_payment', 'awaiting_confirmation')
     ORDER BY created_at DESC
     LIMIT 1`,
    [bookingId]
  );
  return rows[0] || null;
}

// --- Lifecycle transitions. Each is guarded so a terminal payment
// (confirmed / failed / cancelled) can never be moved to another state, and
// so NEFT rows (pending_verification) are untouched by the Cashfree
// transitions. Each returns the updated row, or null when the guard blocked
// the change. ---

const NON_TERMINAL = "('pending', 'awaiting_payment', 'awaiting_confirmation')";

export async function markPaymentAwaitingPayment(id) {
  const { rows } = await pool.query(
    `UPDATE payments SET status = 'awaiting_payment', updated_at = now()
     WHERE id = $1 AND status IN ('pending', 'awaiting_payment')
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function markPaymentAwaitingConfirmation(id, { cashfreePaymentId } = {}) {
  const { rows } = await pool.query(
    `UPDATE payments
     SET status = 'awaiting_confirmation',
         cashfree_payment_id = COALESCE($2, cashfree_payment_id),
         updated_at = now()
     WHERE id = $1 AND status IN ${NON_TERMINAL}
     RETURNING *`,
    [id, cashfreePaymentId || null]
  );
  return rows[0] || null;
}

export async function markPaymentCancelled(id) {
  const { rows } = await pool.query(
    `UPDATE payments SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND status IN ${NON_TERMINAL}
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function markPaymentFailed(id) {
  const { rows } = await pool.query(
    `UPDATE payments SET status = 'failed', updated_at = now()
     WHERE id = $1 AND status IN ${NON_TERMINAL}
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Atomic "flip to confirmed exactly once". Returns the row ONLY when this call
// is the one that changed it (status was not already 'confirmed'); returns
// null for a duplicate/re-delivered confirmation so the caller can skip the
// downstream booking credit + side effects entirely.
export async function markPaymentConfirmed(id, { cashfreePaymentId, verifiedByUserId } = {}) {
  const { rows } = await pool.query(
    `UPDATE payments
     SET status = 'confirmed', paid_at = now(),
         cashfree_payment_id = COALESCE($2, cashfree_payment_id),
         verified_by_user_id = COALESCE($3, verified_by_user_id),
         verified_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE verified_at END,
         updated_at = now()
     WHERE id = $1 AND status <> 'confirmed'
     RETURNING *`,
    [id, cashfreePaymentId || null, verifiedByUserId || null]
  );
  return rows[0] || null;
}

export async function markPaymentRejected(id, verifiedByUserId) {
  const { rows } = await pool.query(
    `UPDATE payments
     SET status = 'failed', verified_by_user_id = $2, verified_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, verifiedByUserId]
  );
  return rows[0] || null;
}

export async function listNeftPending() {
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

export async function insertTransaction({ agencyId, bookingId, paymentId, amount, method, status }) {
  const { rows } = await pool.query(
    `INSERT INTO transactions (agency_id, booking_id, payment_id, amount, method, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [agencyId, bookingId, paymentId, amount, method, status]
  );
  return rows[0];
}

export async function listAgencyTransactions(agencyId) {
  const { rows } = await pool.query(
    `SELECT transactions.*, bookings.source_type
     FROM transactions
     JOIN bookings ON bookings.id = transactions.booking_id
     WHERE transactions.agency_id = $1
     ORDER BY transactions.created_at DESC`,
    [agencyId]
  );
  return rows;
}

export async function listAllTransactions({ method, status, dateFrom } = {}) {
  const clauses = [];
  const values = [];
  let i = 1;

  if (method) {
    clauses.push(`transactions.method = $${i}`);
    values.push(method);
    i += 1;
  }
  if (status) {
    clauses.push(`transactions.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (dateFrom) {
    clauses.push(`transactions.created_at >= $${i}`);
    values.push(dateFrom);
    i += 1;
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
