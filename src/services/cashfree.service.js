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

// Doc §14.1 steps 55-56: create a Cashfree order tagged with booking_id, return payment_session_id.
export async function createOrder({ bookingId, amount, customerEmail, customerPhone, customerId }) {
  ensureConfigured();

  const res = await fetch(`${env.cashfree.apiBaseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': env.cashfree.appId,
      'x-client-secret': env.cashfree.secretKey,
      'x-api-version': '2023-08-01',
    },
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
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.message || 'Cashfree order creation failed');
    err.status = 502;
    err.publicCode = 'cashfree_error';
    throw err;
  }

  return { orderId: data.order_id, paymentSessionId: data.payment_session_id };
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
