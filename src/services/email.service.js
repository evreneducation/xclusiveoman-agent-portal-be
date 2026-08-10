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

/**
 * Sends an email via Google SMTP when configured; otherwise logs it to the
 * console so flows like password reset stay testable without real credentials.
 *
 * `replyTo` is optional (Marketing Center's per-agency Relationship Manager
 * reply-to, marketing.controller.js) — omitted entirely when not given, same
 * as every other caller of this function today.
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  const t = getTransporter();

  if (!t) {
    console.log('--- [email.service] SMTP not configured, logging email instead ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    console.log('---------------------------------------------------------------');
    return { delivered: false, logged: true };
  }

  await t.sendMail({ from: env.smtp.from, to, subject, html, text, ...(replyTo ? { replyTo } : {}) });
  return { delivered: true, logged: false };
}
