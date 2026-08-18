import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

function getTransporter() {
  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  return transporter;
}

// Same three-var check getTransporter() already does, exposed separately so
// callers (Marketing Center's Send Test/Send Campaign — marketing.controller.js)
// can fail fast with one clear "not configured" error up front instead of
// discovering it once per recipient inside the send loop.
export function isSmtpConfigured() {
  return !!(env.smtp.host && env.smtp.user && env.smtp.pass);
}

// Channel Settings "Test Connection" (Marketing Center Task 9) — an actual
// round-trip to the SMTP server (nodemailer's built-in `verify()`: opens the
// connection and authenticates, same as a real send would, but never queues
// a message) rather than just re-checking that the three env vars are
// non-empty. isSmtpConfigured() above answers "do credentials exist"; this
// answers "does the server actually accept them right now" — the stricter
// bar Channel Settings' "Connected" status requires. Never throws: a bad
// host/port/credential is a normal, expected outcome here, not a server
// error, so it's reported back as `{ verified, reason }` instead. `reason`
// is nodemailer/SMTP's own response text (e.g. "535 Authentication
// failed") — never the password itself.
export async function verifySmtpConnection() {
  if (!isSmtpConfigured()) {
    return { verified: false, reason: 'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS are not all set).' };
  }
  const t = getTransporter();
  try {
    await t.verify();
    return { verified: true, reason: null };
  } catch (err) {
    return { verified: false, reason: err.message || 'Could not connect to the SMTP server.' };
  }
}

/**
 * Sends an email via Google SMTP when configured; otherwise logs it to the
 * console so flows like password reset stay testable without real credentials.
 *
 * `replyTo` is optional (Marketing Center's per-agency Relationship Manager
 * reply-to, marketing.controller.js) — omitted entirely when not given, same
 * as every other caller of this function today.
 *
 * `attachments` is optional and passed straight through to nodemailer's own
 * `sendMail` — Marketing Center's branded HTML template
 * (emailTemplate.service.js#buildMarketingEmailHtml) uses this to embed the
 * logo as a real MIME attachment referenced by `cid:` in its `html`, rather
 * than a remote URL or a data URI (more broadly supported by mail clients).
 * Callers that don't pass it (password reset, payment confirmation, …) are
 * completely unaffected.
 */
export async function sendEmail({ to, subject, html, text, replyTo, attachments }) {
  const t = getTransporter();

  if (!t) {
    console.log('--- [email.service] SMTP not configured, logging email instead ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    console.log('---------------------------------------------------------------');
    return { delivered: false, logged: true };
  }

  await t.sendMail({
    from: env.smtp.from,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
    ...(attachments ? { attachments } : {}),
  });
  return { delivered: true, logged: false };
}
