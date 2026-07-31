import { pool } from '../db/pool.js';

export async function createPayment({ bookingId, amount, method, status, cashfreeOrderId, neftSlipUrl, neftReference }) {
  const { rows } = await pool.query(
    `INSERT INTO payments (booking_id, amount, method, status, cashfree_order_id, neft_slip_url, neft_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [bookingId, amount, method, status, cashfreeOrderId || null, neftSlipUrl || null, neftReference || null]
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

export async function markPaymentConfirmed(id, { cashfreePaymentId, verifiedByUserId } = {}) {
  const { rows } = await pool.query(
    `UPDATE payments
     SET status = 'confirmed', paid_at = now(),
         cashfree_payment_id = COALESCE($2, cashfree_payment_id),
         verified_by_user_id = COALESCE($3, verified_by_user_id),
         verified_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE verified_at END,
         updated_at = now()
     WHERE id = $1 RETURNING *`,
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
