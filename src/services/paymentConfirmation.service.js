import { pool } from '../db/pool.js';
import { findBookingById } from '../models/bookings.model.js';
import { insertTransaction } from '../models/payments.model.js';
import { findUserById } from '../models/users.model.js';
import { sendEmail } from './email.service.js';
import { getIo } from '../sockets/index.js';

/**
 * Shared by every "money landed" path — Cashfree webhook success and NEFT
 * admin-approve alike (doc §13/§14: booking:status_changed + notification:new,
 * receipt email). Later sprints' FIT/MICE accept-and-pay flows reuse this too.
 *
 * Idempotent: callers only reach here after markPaymentConfirmed() atomically
 * flipped the payment to 'confirmed' (so a re-delivered webhook is filtered
 * out upstream), and the transactions(payment_id) unique index is the final
 * net — the transaction INSERT runs first, so a duplicate trips 23505 and the
 * booking is never credited twice / no duplicate email + socket effects fire.
 */
export async function confirmPayment(payment) {
  const booking = await findBookingById(payment.booking_id);
  if (!booking) return;

  // Whether this payment leaves a balance still owed or settles the booking
  // in full — computed up front so both the transaction record and the
  // booking's own status agree on the same word (previously the transaction
  // always said 'confirmed' regardless of completeness, and partial payments
  // pushed the booking itself to 'confirmed' too, indistinguishable from a
  // fully-settled one).
  const newDepositPaid = Number(booking.deposit_paid) + Number(payment.amount);
  const newBalanceDue = Math.max(0, Number(booking.total_price) - newDepositPaid);
  const status = newBalanceDue <= 0 ? 'fully_paid' : 'balance_due';

  try {
    await insertTransaction({
      agencyId: booking.agency_id,
      bookingId: booking.id,
      paymentId: payment.id,
      amount: payment.amount,
      method: payment.method,
      status,
      totalPrice: booking.total_price,
      amountPaidToDate: newDepositPaid,
    });
  } catch (err) {
    // MySQL's duplicate-key error code (ER_DUP_ENTRY), replacing Postgres' '23505'
    // — same transactions(payment_id) unique index, different driver's error shape.
    if (err.code === 'ER_DUP_ENTRY') return; // already processed by an earlier delivery
    throw err;
  }

  await pool.query(
    `UPDATE bookings SET status = ?, deposit_paid = ?, balance_due = ?, updated_at = now() WHERE id = ?`,
    [status, newDepositPaid, newBalanceDue, booking.id]
  );

  const creator = await findUserById(booking.created_by_user_id);
  if (creator) {
    await sendEmail({
      to: creator.email,
      subject: 'Payment received — Xclusive Oman',
      text: `We've received your payment of ₹${payment.amount} for booking ${booking.id}. Booking status: ${status}.`,
    });
  }

  const io = getIo();
  io?.to(`agency:${booking.agency_id}`).emit('booking:status_changed', {
    bookingId: booking.id,
    status,
  });
  // Fast UI signal for the Payment page / return page (spec M). Webhook + the
  // GET /api/payments/:id poll remain the authoritative / fallback paths.
  io?.to(`agency:${booking.agency_id}`).emit('payment:status_changed', {
    bookingId: booking.id,
    paymentId: payment.id,
    status: 'confirmed',
  });
  io?.to(`agency:${booking.agency_id}`).emit('notification:new', {
    type: 'payment_confirmed',
    title: 'Payment confirmed',
    body: `₹${payment.amount} received — booking ${status === 'fully_paid' ? 'fully paid' : 'balance due'}.`,
  });
}
