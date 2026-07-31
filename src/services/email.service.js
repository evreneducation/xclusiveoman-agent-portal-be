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

/**
 * Sends an email via Google SMTP when configured; otherwise logs it to the
 * console so flows like password reset stay testable without real credentials.
 */
export async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();

  if (!t) {
    console.log('--- [email.service] SMTP not configured, logging email instead ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    console.log('---------------------------------------------------------------');
    return { delivered: false, logged: true };
  }

  await t.sendMail({ from: env.smtp.from, to, subject, html, text });
  return { delivered: true, logged: false };
}
