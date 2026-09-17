const crypto = require('node:crypto');

const {
  env
} = require('../config/env.js');

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

async function createOrder({ bookingId, amount, customerEmail, customerPhone, customerId }) {
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

module.exports.createOrder = createOrder;

async function getOrder(orderId) {
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

module.exports.getOrder = getOrder;

async function getOrderPayments(orderId) {
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

module.exports.getOrderPayments = getOrderPayments;

async function terminateOrder(orderId) {
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

module.exports.terminateOrder = terminateOrder;

function verifyWebhookSignature({ rawBody, timestamp, signature }) {
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

module.exports.verifyWebhookSignature = verifyWebhookSignature;
