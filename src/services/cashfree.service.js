import crypto from 'node:crypto';
import { env } from '../config/env.js';

function ensureConfigured() {
  if (!env.cashfree.appId || !env.cashfree.secretKey) {
    throw Object.assign(new Error('Cashfree is not configured (set CASHFREE_* in .env)'), {
      status: 503,
      publicCode: 'payments_unavailable',
    });
  }
}

const CF_HEADERS = () => ({
  'Content-Type': 'application/json',
  'x-client-id': env.cashfree.appId,
  'x-client-secret': env.cashfree.secretKey,
  'x-api-version': '2023-08-01',
});

// Never leak Cashfree's raw error/credentials to the client (spec P) — a
// generic 502 with our own publicCode, matching the pattern createOrder
// already used.
function cashfreeError(fallback) {
  const err = new Error(fallback);
  err.status = 502;
  err.publicCode = 'cashfree_error';
  return err;
}

// Doc §14.1 steps 55-56: create a Cashfree order tagged with booking_id, return
// payment_session_id. `order_meta` wires the browser return redirect and the
// server-to-server webhook so reconciliation has both a push and a pull path.
export async function createOrder({ bookingId, amount, customerEmail, customerPhone, customerId }) {
  ensureConfigured();

  const res = await fetch(`${env.cashfree.apiBaseUrl}/orders`, {
    method: 'POST',
    headers: CF_HEADERS(),
    body: JSON.stringify({
      order_id: `booking-${bookingId}-${Date.now()}`,
      order_amount: amount,
      order_currency: 'INR',
      order_tag: bookingId,
      customer_details: {
        customer_id: customerId,
        customer_email: customerEmail,
        customer_phone: customerPhone || '0000000000',
      },
      order_meta: {
        // Cashfree substitutes {order_id} on redirect. agentPortalUrl already
        // ends in "/agent" (see config/env.js), so this lands on the SPA's
        // /agent/payments/return route which drives GET /api/payments polling.
        return_url: `${env.agentPortalUrl}/payments/return?order_id={order_id}`,
        notify_url: `${env.apiBaseUrl}/api/webhooks/cashfree`,
      },
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw cashfreeError(data?.message || 'Cashfree order creation failed');
  }

  return { orderId: data.order_id, paymentSessionId: data.payment_session_id };
}

// GET /orders/{order_id} — used by reconciliation and the reuse/supersede
// decision in createCashfreeOrder. Returns null (rather than throwing) when
// the order can't be read, so callers can fall back to their local state.
export async function getOrder(orderId) {
  ensureConfigured();
  try {
    const res = await fetch(`${env.cashfree.apiBaseUrl}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: CF_HEADERS(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// GET /orders/{order_id}/payments — the individual payment attempts on an
// order, newest first. Used to pull cf_payment_id / a granular payment_status
// when the order itself is no longer ACTIVE. Returns [] on any failure.
export async function getOrderPayments(orderId) {
  ensureConfigured();
  try {
    const res = await fetch(`${env.cashfree.apiBaseUrl}/orders/${encodeURIComponent(orderId)}/payments`, {
      method: 'GET',
      headers: CF_HEADERS(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// PATCH /orders/{order_id} { order_status: 'TERMINATED' } — kills a stale
// checkout link when a new attempt supersedes it, or on explicit abort.
// Idempotent by design: an order that is already PAID / TERMINATED / EXPIRED
// can't be terminated and Cashfree returns an error for it — we swallow that
// and report { terminated: false } rather than throwing (spec P).
export async function terminateOrder(orderId) {
  ensureConfigured();
  try {
    const res = await fetch(`${env.cashfree.apiBaseUrl}/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: CF_HEADERS(),
      body: JSON.stringify({ order_status: 'TERMINATED' }),
    });
    return { terminated: res.ok };
  } catch {
    return { terminated: false };
  }
}

// Doc §14.1 step 58 / §16: verifies the webhook signature before trusting the payload.
export function verifyWebhookSignature({ rawBody, timestamp, signature }) {
  if (!env.cashfree.webhookSecret || !signature || !timestamp) return false;

  const expected = crypto
    .createHmac('sha256', env.cashfree.webhookSecret)
    .update(timestamp + rawBody)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false; // length mismatch etc. -> not authentic
  }
}
