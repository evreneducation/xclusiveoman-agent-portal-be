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
 */
export async function confirmPayment(payment) {
  const booking = await findBookingById(payment.booking_id);
  if (!booking) return;

  const newDepositPaid = Number(booking.deposit_paid) + Number(payment.amount);
  const newBalanceDue = Math.max(0, Number(booking.total_price) - newDepositPaid);
  const status = newBalanceDue <= 0 ? 'fully_paid' : 'confirmed';

  await pool.query(
    `UPDATE bookings SET status = $2, deposit_paid = $3, balance_due = $4, updated_at = now() WHERE id = $1`,
    [booking.id, status, newDepositPaid, newBalanceDue]
  );

  await insertTransaction({
    agencyId: booking.agency_id,
    bookingId: booking.id,
    paymentId: payment.id,
    amount: payment.amount,
    method: payment.method,
    status: 'confirmed',
  });

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
  io?.to(`agency:${booking.agency_id}`).emit('notification:new', {
    type: 'payment_confirmed',
    title: 'Payment confirmed',
    body: `₹${payment.amount} received — booking ${status === 'fully_paid' ? 'fully paid' : 'confirmed'}.`,
  });
}
