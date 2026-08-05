import { createOrder, verifyWebhookSignature } from '../services/cashfree.service.js';
import { uploadBuffer } from '../services/cloudinary.service.js';
import { confirmPayment } from '../services/paymentConfirmation.service.js';
import { sendEmail } from '../services/email.service.js';
import { getIo } from '../sockets/index.js';
import {
  createPayment,
  findPaymentById,
  findPaymentByCashfreeOrderId,
  markPaymentConfirmed,
  markPaymentRejected,
  listNeftPending,
  listAgencyTransactions,
  listAllTransactions,
} from '../models/payments.model.js';
import { findBookingById } from '../models/bookings.model.js';
import { findUserById } from '../models/users.model.js';

function toPublicPayment(p) {
  return {
    id: p.id,
    bookingId: p.booking_id,
    amount: Number(p.amount),
    method: p.method,
    status: p.status,
    neftSlipUrl: p.neft_slip_url,
    neftReference: p.neft_reference,
    paidAt: p.paid_at,
    createdAt: p.created_at,
    agencyName: p.agency_name,
  };
}

function toPublicTransaction(t) {
  return {
    id: t.id,
    agencyId: t.agency_id,
    agencyName: t.agency_name,
    bookingId: t.booking_id,
    amount: Number(t.amount),
    method: t.method,
    status: t.status,
    invoiceUrl: t.invoice_url,
    voucherUrl: t.voucher_url,
    createdAt: t.created_at,
  };
}

async function assertOwnsBooking(req, res, bookingId) {
  const booking = await findBookingById(bookingId);
  if (!booking || booking.agency_id !== req.user.agency_id) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return booking;
}

// POST /api/payments/cashfree/create-order
export async function createCashfreeOrder(req, res, next) {
  try {
    const { bookingId, amount } = req.body;
    const booking = await assertOwnsBooking(req, res, bookingId);
    if (!booking) return;

    const { orderId, paymentSessionId } = await createOrder({
      bookingId,
      amount,
      customerEmail: req.user.email,
      customerPhone: req.user.phone,
      customerId: req.user.id,
    });

    const payment = await createPayment({
      bookingId,
      amount,
      method: 'cashfree',
      status: 'pending',
      cashfreeOrderId: orderId,
    });

    res.status(201).json({ payment: toPublicPayment(payment), paymentSessionId });
  } catch (err) {
    next(err);
  }
}

// POST /api/webhooks/cashfree — public, signature-verified (doc §14.1/§16).
export async function cashfreeWebhook(req, res) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const rawBody = req.body?.toString('utf8') || '';

  if (!verifyWebhookSignature({ rawBody, timestamp, signature })) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const orderId = event?.data?.order?.order_id;
  const paymentStatus = event?.data?.payment?.payment_status;
  const cashfreePaymentId = event?.data?.payment?.cf_payment_id;

  const payment = orderId ? await findPaymentByCashfreeOrderId(orderId) : null;
  if (payment && paymentStatus === 'SUCCESS' && payment.status !== 'confirmed') {
    const confirmed = await markPaymentConfirmed(payment.id, { cashfreePaymentId });
    await confirmPayment(confirmed);
  }

  res.status(200).json({ received: true });
}

// POST /api/payments/:bookingId/neft-slip — multipart, requires the slip file at req.file.
export async function uploadNeftSlip(req, res, next) {
  try {
    const { bookingId } = req.params;
    const booking = await assertOwnsBooking(req, res, bookingId);
    if (!booking) return;

    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'Upload the NEFT transfer slip' });
    }

    const upload = await uploadBuffer(req.file.buffer, {
      folderParts: ['bookings', bookingId, 'neft-slips'],
    });

    const payment = await createPayment({
      bookingId,
      amount: req.body.amount,
      method: 'neft',
      status: 'pending_verification',
      neftSlipUrl: upload.secure_url,
      neftReference: req.body.reference,
    });

    getIo()?.to('role:finance').emit('notification:new', {
      type: 'neft_slip_submitted',
      title: 'NEFT slip submitted',
      body: `Booking ${bookingId} — ₹${req.body.amount}`,
    });

    res.status(201).json({ payment: toPublicPayment(payment) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/neft-verifications?status=pending
export async function getNeftPending(req, res, next) {
  try {
    const rows = await listNeftPending();
    res.json({ payments: rows.map(toPublicPayment) });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/payments/:id/verify — { approve: boolean, reason?: string }
export async function verifyNeftPayment(req, res, next) {
  try {
    const payment = await findPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'not_found' });

    if (req.body.approve) {
      const confirmed = await markPaymentConfirmed(payment.id, { verifiedByUserId: req.user.id });
      await confirmPayment(confirmed);
      return res.json({ payment: toPublicPayment(confirmed) });
    }

    const rejected = await markPaymentRejected(payment.id, req.user.id);
    const booking = await findBookingById(payment.booking_id);
    const creator = booking ? await findUserById(booking.created_by_user_id) : null;
    if (creator) {
      await sendEmail({
        to: creator.email,
        subject: 'NEFT slip rejected — Xclusive Oman',
        text: `Your NEFT slip for booking ${payment.booking_id} was rejected.${
          req.body.reason ? ` Reason: ${req.body.reason}` : ''
        } Please re-upload.`,
      });
    }
    if (booking) {
      getIo()?.to(`agency:${booking.agency_id}`).emit('neft:rejected', {
        bookingId: booking.id,
        reason: req.body.reason || null,
      });
    }

    res.json({ payment: toPublicPayment(rejected) });
  } catch (err) {
    next(err);
  }
}

// GET /api/agencies/me/transactions
export async function getMyTransactions(req, res, next) {
  try {
    const rows = await listAgencyTransactions(req.user.agency_id);
    res.json({ transactions: rows.map(toPublicTransaction) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/transactions?method=&status=&date_from=
export async function getAllTransactions(req, res, next) {
  try {
    const { method, status, date_from: dateFrom } = req.query;
    const rows = await listAllTransactions({ method, status, dateFrom });
    res.json({ transactions: rows.map(toPublicTransaction) });
  } catch (err) {
    next(err);
  }
}
