import {
  createOrder,
  verifyWebhookSignature,
  getOrder,
  getOrderPayments,
  terminateOrder,
} from '../services/cashfree.service.js';
import { uploadBuffer } from '../services/cloudinary.service.js';
import { confirmPayment } from '../services/paymentConfirmation.service.js';
import { sendEmail } from '../services/email.service.js';
import { getIo } from '../sockets/index.js';
import {
  createPayment,
  findPaymentById,
  findPaymentByCashfreeOrderId,
  findPaymentByClientAttemptToken,
  findActiveCashfreePayment,
  markPaymentAwaitingPayment,
  markPaymentAwaitingConfirmation,
  markPaymentCancelled,
  markPaymentFailed,
  markPaymentConfirmed,
  markPaymentRejected,
  listNeftPending,
  listAgencyTransactions,
  listAllTransactions,
} from '../models/payments.model.js';
import { findBookingById } from '../models/bookings.model.js';
import { findUserById } from '../models/users.model.js';

// A payment in one of these states is done — never move it to another state
// (spec A). Used to short-circuit the webhook, reconciliation and abort.
const TERMINAL_PAYMENT_STATUSES = new Set(['confirmed', 'failed', 'cancelled', 'pending_verification']);

// How long a freshly-created Cashfree order is considered reusable before a
// new "Pay" click supersedes it instead (spec C).
const REUSE_WINDOW_MS = 15 * 60 * 1000;

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
    updatedAt: p.updated_at,
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

// Part-payment guard (0077_booking_deposit_due.sql). The first payment on a
// booking must clear "amount due now" — the full price within 15 days of
// departure, otherwise the flat deposit — and no payment may exceed what's
// still outstanding. Returns a message string to reject with, or null if
// `amount` is acceptable. Kept here (not the zod schema) because the bounds
// depend on the specific booking's state, not just the shape of the input.
function rejectPaymentAmount(booking, amount) {
  const EPSILON = 0.01; // NUMERIC round-trips as a float; don't reject a legit exact payment on the 15th decimal
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return 'Enter a valid payment amount.';

  const balanceDue = Number(booking.balance_due);
  if (amt > balanceDue + EPSILON) {
    return `That is more than the outstanding balance of ${balanceDue}.`;
  }

  const amountDueNow = Math.max(0, Number(booking.deposit_due) - Number(booking.deposit_paid));
  if (amountDueNow > 0 && amt + EPSILON < amountDueNow) {
    return `A payment of at least ${amountDueNow} is required to confirm this booking.`;
  }
  return null;
}

// Fast UI signal (spec M). Webhook + GET /api/payments/:id polling stay the
// authoritative / fallback mechanisms — this is best-effort on top.
async function emitPaymentStatusChanged({ agencyId, bookingId, paymentId, status }) {
  let aId = agencyId;
  if (!aId && bookingId) {
    const booking = await findBookingById(bookingId);
    aId = booking?.agency_id;
  }
  if (!aId) return;
  getIo()?.to(`agency:${aId}`).emit('payment:status_changed', { bookingId, paymentId, status });
}

// Shared "Cashfree says paid" path — webhook SUCCESS, live reconciliation, and
// (for NEFT, which skips the awaiting_confirmation hop) admin approval all run
// through here. markPaymentConfirmed is atomic: it returns a row only for the
// call that actually flipped pending -> confirmed, so a re-delivered webhook
// never reaches confirmPayment twice.
async function advanceToConfirmed(payment, { cashfreePaymentId, verifiedByUserId, agencyId } = {}) {
  const awaiting = await markPaymentAwaitingConfirmation(payment.id, { cashfreePaymentId });
  if (awaiting) {
    await emitPaymentStatusChanged({
      agencyId,
      bookingId: payment.booking_id,
      paymentId: payment.id,
      status: 'awaiting_confirmation',
    });
  }
  const confirmed = await markPaymentConfirmed(payment.id, { cashfreePaymentId, verifiedByUserId });
  if (confirmed) {
    await confirmPayment(confirmed); // emits its own 'confirmed' + booking:status_changed
    return confirmed;
  }
  return null;
}

// Live check against Cashfree for a still-open attempt — the fallback when a
// webhook is slow or missed (spec I). Advances local state and returns the
// latest payment row.
async function reconcileCashfreePayment(payment, booking) {
  if (payment.method !== 'cashfree' || !payment.cashfree_order_id) return payment;
  if (TERMINAL_PAYMENT_STATUSES.has(payment.status)) return payment;

  const order = await getOrder(payment.cashfree_order_id);
  if (!order) return payment;

  const orderStatus = order.order_status; // ACTIVE | PAID | EXPIRED | TERMINATED

  if (orderStatus === 'PAID') {
    const attempts = await getOrderPayments(payment.cashfree_order_id);
    const ok = attempts.find((a) => a.payment_status === 'SUCCESS');
    await advanceToConfirmed(payment, {
      cashfreePaymentId: ok?.cf_payment_id ? String(ok.cf_payment_id) : null,
      agencyId: booking.agency_id,
    });
    return (await findPaymentById(payment.id)) || payment;
  }

  if (orderStatus === 'EXPIRED' || orderStatus === 'TERMINATED') {
    const cancelled = await markPaymentCancelled(payment.id);
    if (cancelled) {
      await emitPaymentStatusChanged({
        agencyId: booking.agency_id,
        bookingId: payment.booking_id,
        paymentId: payment.id,
        status: 'cancelled',
      });
      return cancelled;
    }
  }

  return payment;
}

// POST /api/payments/cashfree/create-order
// Idempotent + one-active-attempt-per-booking (spec C). Response keeps the
// existing `{ payment, paymentSessionId }` contract and adds `paymentId` /
// `orderId`.
export async function createCashfreeOrder(req, res, next) {
  try {
    const { bookingId, amount, clientAttemptToken } = req.body;
    const booking = await assertOwnsBooking(req, res, bookingId);
    if (!booking) return;

    const amountError = rejectPaymentAmount(booking, amount);
    if (amountError) return res.status(400).json({ error: 'invalid_amount', message: amountError });

    // 1) Idempotent replay — the same intent token already produced a row
    // (network retry / double request). Return it, don't create a second.
    if (clientAttemptToken) {
      const prior = await findPaymentByClientAttemptToken(clientAttemptToken);
      if (prior) {
        const order = await getOrder(prior.cashfree_order_id);
        return res.status(200).json({
          payment: toPublicPayment(prior),
          paymentId: prior.id,
          orderId: prior.cashfree_order_id,
          paymentSessionId: order?.payment_session_id || null,
        });
      }
    }

    // 2) Reuse or supersede the booking's existing active attempt.
    const active = await findActiveCashfreePayment(bookingId);
    if (active) {
      const ageMs = Date.now() - new Date(active.created_at).getTime();
      const order = await getOrder(active.cashfree_order_id);
      const reusable = ageMs < REUSE_WINDOW_MS && order?.order_status === 'ACTIVE';

      if (reusable) {
        const awaiting = await markPaymentAwaitingPayment(active.id);
        const current = awaiting || active;
        if (awaiting && awaiting.status !== active.status) {
          await emitPaymentStatusChanged({
            agencyId: booking.agency_id,
            bookingId,
            paymentId: current.id,
            status: current.status,
          });
        }
        return res.status(200).json({
          payment: toPublicPayment(current),
          paymentId: current.id,
          orderId: current.cashfree_order_id,
          paymentSessionId: order.payment_session_id,
        });
      }

      // Stale / already paid / already failed at the gateway -> retire it.
      const cancelled = await markPaymentCancelled(active.id);
      if (cancelled) {
        if (order?.order_status === 'ACTIVE') await terminateOrder(active.cashfree_order_id);
        await emitPaymentStatusChanged({
          agencyId: booking.agency_id,
          bookingId,
          paymentId: active.id,
          status: 'cancelled',
        });
      } else {
        // It went terminal under us between the read and the update.
        const fresh = await findPaymentById(active.id);
        if (fresh && TERMINAL_PAYMENT_STATUSES.has(fresh.status) && fresh.status !== 'cancelled') {
          return res.status(200).json({
            payment: toPublicPayment(fresh),
            paymentId: fresh.id,
            orderId: fresh.cashfree_order_id,
            paymentSessionId: null,
          });
        }
      }
    }

    // 3) Fresh order + payment row.
    const { orderId, paymentSessionId } = await createOrder({
      bookingId,
      amount,
      customerEmail: req.user.email,
      customerPhone: req.user.phone,
      customerId: req.user.id,
    });

    let payment;
    try {
      payment = await createPayment({
        bookingId,
        amount,
        method: 'cashfree',
        status: 'pending',
        cashfreeOrderId: orderId,
        clientAttemptToken,
      });
    } catch (err) {
      // A concurrent request beat us — either the same intent token
      // (uq_payments_client_attempt_token) or the single active-attempt slot
      // (one_active_cashfree_payment). The DB constraint is the final
      // protection (spec C): discard the order we just opened and return the
      // row the winning request created.
      if (err.code === '23505') {
        await terminateOrder(orderId);
        const winner =
          (clientAttemptToken && (await findPaymentByClientAttemptToken(clientAttemptToken))) ||
          (await findActiveCashfreePayment(bookingId));
        if (winner) {
          const order = await getOrder(winner.cashfree_order_id);
          return res.status(200).json({
            payment: toPublicPayment(winner),
            paymentId: winner.id,
            orderId: winner.cashfree_order_id,
            paymentSessionId: order?.payment_session_id || null,
          });
        }
      }
      throw err;
    }

    // Checkout is about to launch -> awaiting_payment (spec D). The actual
    // success only ever comes from webhook / reconciliation.
    const awaiting = await markPaymentAwaitingPayment(payment.id);
    const current = awaiting || payment;
    await emitPaymentStatusChanged({
      agencyId: booking.agency_id,
      bookingId,
      paymentId: current.id,
      status: current.status,
    });

    res.status(201).json({
      payment: toPublicPayment(current),
      paymentId: current.id,
      orderId,
      paymentSessionId,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/:id — owner-scoped reconciliation/poll target (spec G).
// For a still-open Cashfree attempt it also does a live gateway check so a
// missed/slow webhook still resolves.
export async function getPaymentStatus(req, res, next) {
  try {
    const payment = await findPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'not_found' });
    const booking = await assertOwnsBooking(req, res, payment.booking_id);
    if (!booking) return; // 404 already sent

    let current = payment;
    if (payment.method === 'cashfree' && !TERMINAL_PAYMENT_STATUSES.has(payment.status)) {
      current = await reconcileCashfreePayment(payment, booking);
    }
    res.json({ payment: toPublicPayment(current) });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/by-order/:orderId — the Cashfree return page only carries
// the order_id; resolve it (owner-scoped) so the page can start polling.
export async function getPaymentByOrder(req, res, next) {
  try {
    const payment = await findPaymentByCashfreeOrderId(req.params.orderId);
    if (!payment) return res.status(404).json({ error: 'not_found' });
    const booking = await assertOwnsBooking(req, res, payment.booking_id);
    if (!booking) return;

    let current = payment;
    if (!TERMINAL_PAYMENT_STATUSES.has(payment.status)) {
      current = await reconcileCashfreePayment(payment, booking);
    }
    res.json({ payment: toPublicPayment(current) });
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/:id/abort — owner-scoped (spec H). Cancels a
// pending/awaiting_payment attempt and kills its Cashfree order. Idempotent
// no-op for any other state; never cancels a confirmed payment.
export async function abortPayment(req, res, next) {
  try {
    const payment = await findPaymentById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'not_found' });
    const booking = await assertOwnsBooking(req, res, payment.booking_id);
    if (!booking) return;

    if (!['pending', 'awaiting_payment'].includes(payment.status)) {
      return res.json({ payment: toPublicPayment(payment) });
    }

    const cancelled = await markPaymentCancelled(payment.id);
    if (!cancelled) {
      // Raced to a terminal state between read and update.
      return res.json({ payment: toPublicPayment((await findPaymentById(payment.id)) || payment) });
    }

    if (payment.method === 'cashfree' && payment.cashfree_order_id) {
      const order = await getOrder(payment.cashfree_order_id);
      if (order?.order_status === 'ACTIVE') await terminateOrder(payment.cashfree_order_id);
    }

    await emitPaymentStatusChanged({
      agencyId: booking.agency_id,
      bookingId: payment.booking_id,
      paymentId: payment.id,
      status: 'cancelled',
    });

    res.json({ payment: toPublicPayment(cancelled) });
  } catch (err) {
    next(err);
  }
}

// POST /api/webhooks/cashfree — public, signature-verified (doc §14.1/§16).
// Identifies the payment ONLY by Cashfree's order_id, is safe against
// duplicate / out-of-order delivery, and never touches a terminal payment.
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

  try {
    const orderId = event?.data?.order?.order_id;
    const paymentStatus = event?.data?.payment?.payment_status; // SUCCESS | FAILED | USER_DROPPED | CANCELLED | PENDING
    const orderStatus = event?.data?.order?.order_status; // PAID | EXPIRED | TERMINATED | ACTIVE
    const eventType = event?.type || '';
    const cashfreePaymentId = event?.data?.payment?.cf_payment_id
      ? String(event.data.payment.cf_payment_id)
      : null;

    const payment = orderId ? await findPaymentByCashfreeOrderId(orderId) : null;

    // Unknown order, or already done -> ack and ignore (duplicate delivery).
    if (!payment || TERMINAL_PAYMENT_STATUSES.has(payment.status)) {
      return res.status(200).json({ received: true });
    }

    const booking = await findBookingById(payment.booking_id);
    const agencyId = booking?.agency_id;

    const isSuccess =
      paymentStatus === 'SUCCESS' || orderStatus === 'PAID' || eventType === 'PAYMENT_SUCCESS_WEBHOOK';
    const isFailed = paymentStatus === 'FAILED' || eventType === 'PAYMENT_FAILED_WEBHOOK';
    const isDropped =
      paymentStatus === 'USER_DROPPED' ||
      paymentStatus === 'CANCELLED' ||
      eventType === 'PAYMENT_USER_DROPPED_WEBHOOK';
    const isExpired =
      orderStatus === 'EXPIRED' || orderStatus === 'TERMINATED' || eventType === 'ORDER_EXPIRED';

    if (isSuccess) {
      await advanceToConfirmed(payment, { cashfreePaymentId, agencyId });
    } else if (isFailed) {
      const p = await markPaymentFailed(payment.id);
      if (p) {
        await emitPaymentStatusChanged({
          agencyId,
          bookingId: payment.booking_id,
          paymentId: payment.id,
          status: 'failed',
        });
      }
    } else if (isDropped || isExpired) {
      const p = await markPaymentCancelled(payment.id);
      if (p) {
        await emitPaymentStatusChanged({
          agencyId,
          bookingId: payment.booking_id,
          paymentId: payment.id,
          status: 'cancelled',
        });
      }
    }
  } catch (err) {
    // Never 5xx an authenticated webhook — Cashfree would retry indefinitely.
    // GET /api/payments/:id reconciliation is the safety net.
    console.error('cashfree webhook processing error', err);
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

    const amountError = rejectPaymentAmount(booking, req.body.amount);
    if (amountError) return res.status(400).json({ error: 'invalid_amount', message: amountError });

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
      if (confirmed) {
        await confirmPayment(confirmed);
        return res.json({ payment: toPublicPayment(confirmed) });
      }
      // Already confirmed by an earlier action — return current state.
      return res.json({ payment: toPublicPayment((await findPaymentById(payment.id)) || payment) });
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
