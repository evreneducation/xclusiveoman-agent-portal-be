const {
  readFileSync
} = require('node:fs');

const {
  env
} = require('../config/env.js');

const {
  buildOtpEmailHtml
} = require('./emailTemplate.service.js');

// Brevo (formerly Sendinblue) transactional email HTTP API — the sole email
// transport in this app now. SMTP/Nodemailer isn't usable on Render for
// outbound mail (confirmed separately), so every email this app sends
// (OTP, registration/approval, staff welcome, Marketing Center, payment
// confirmations, support tickets, FD operations, …) goes out through this
// one function instead. sendEmail's own signature/behavior is unchanged
// from its previous SMTP implementation — every existing caller works
// without modification.
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function isBrevoConfigured() {
  return !!(env.brevo.apiKey && env.brevo.senderEmail);
}

module.exports.isBrevoConfigured = isBrevoConfigured;

async function verifyBrevoConnection() {
  if (!isBrevoConfigured()) {
    return { verified: false, reason: 'Brevo is not configured (BREVO_API_KEY/BREVO_SENDER_EMAIL are not both set).' };
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': env.brevo.apiKey, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { verified: false, reason: `Brevo rejected the API key (${res.status}): ${body.slice(0, 300)}` };
    }
    return { verified: true, reason: null };
  } catch (err) {
    return { verified: false, reason: err.message || 'Could not reach the Brevo API.' };
  }
}

module.exports.verifyBrevoConnection = verifyBrevoConnection;

// Normalizes `to` into Brevo's own [{email}] shape. Every current caller
// passes a single address, but nodemailer's own `to` field already silently
// accepted a comma-separated string or an array too — preserved here rather
// than narrowed, in case that capability is ever actually used.
function toBrevoRecipients(to) {
  const list = Array.isArray(to) ? to : String(to).split(',');
  return list.map((email) => ({ email: email.trim() })).filter((r) => r.email);
}

// sendEmail's own `attachments` arrive in one of two nodemailer-shaped
// forms, both real, confirmed by inspection:
//  - {filename, path, cid, contentDisposition} — the branded logo, read off
//    disk (emailTemplate.service.js's brandedEmailAttachments/
//    buildOtpEmailHtml, used by OTP/registration/approval/staff-welcome/
//    Marketing Center emails).
//  - {filename, content: Buffer} — traveler documents fetched from
//    Cloudinary at send time (travelerDocumentsAdmin.controller.js
//    #emailToSupplier's own `attachments`).
function readAttachmentBuffer(a) {
  return a.content != null ? Buffer.from(a.content) : readFileSync(a.path);
}

// Only the handful of inline-image formats this app actually embeds (the
// branded logo is a PNG) — extend if a new inline image type is ever added.
// Brevo validates an attachment's `name` against a recognized file format,
// so this only ever matters for the mimeTypeFor() data-URI path below, not
// for regular (non-inline) attachments, which pass their own real filename
// (with whatever real extension it already has) straight through.
const IMAGE_MIME_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

function mimeTypeFor(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  return IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
}

// Brevo's transactional email API doesn't reliably render a `cid:`-referenced
// <img> inline the way SMTP/MIME attachments do — and separately, its own
// attachment `name` field must be a real filename with a recognized
// extension (a bare cid string like "xclusive-oman-logo" gets rejected
// outright: "Unsupported file format: xclusive-oman-logo", the actual bug
// this fixes). So any attachment carrying a `cid` that the HTML actually
// references is embedded directly into the HTML as a base64 data URI here,
// at send time, instead of ever being sent to Brevo as an attachment at
// all — the templates themselves (emailTemplate.service.js) are completely
// untouched, they still emit `<img src="cid:xclusive-oman-logo">`; this is
// purely a transport-layer substitution. Attachments with no `cid` (or
// whose cid the HTML doesn't actually reference) pass through unchanged, to
// be sent as regular Brevo attachments by toBrevoAttachments below.
function inlineCidImages(html, attachments) {
  let nextHtml = html;
  const remaining = [];
  for (const a of attachments || []) {
    if (a.cid && nextHtml?.includes(`cid:${a.cid}`)) {
      const dataUri = `data:${mimeTypeFor(a.filename)};base64,${readAttachmentBuffer(a).toString('base64')}`;
      nextHtml = nextHtml.split(`cid:${a.cid}`).join(dataUri);
    } else {
      remaining.push(a);
    }
  }
  return { html: nextHtml, attachments: remaining };
}

// Regular (non-inline) attachments only — inlineCidImages above already
// pulled out anything with a matching `cid:` reference in the HTML. Always
// uses the attachment's own real `filename` (never its `cid`, which is what
// previously caused Brevo to reject the logo as an "unsupported file
// format": a bare cid string has no file extension for Brevo to recognize).
function toBrevoAttachments(attachments) {
  if (!attachments?.length) return undefined;
  return attachments.map((a) => ({
    name: a.filename,
    content: readAttachmentBuffer(a).toString('base64'),
  }));
}

async function sendEmail({ to, subject, html, text, replyTo, attachments }) {
  if (!isBrevoConfigured()) {
    console.log('--- [email.service] Brevo not configured, logging email instead ---');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text || html);
    console.log('---------------------------------------------------------------');
    return { delivered: false, logged: true };
  }

  // Pulls any cid-referenced inline image (the branded logo) out of
  // `attachments` and inlines it into `html` as a data URI — see
  // inlineCidImages' own comment for why. Whatever's left in `attachments`
  // after that are real, non-inline attachments (PDFs, traveler documents, …).
  const { html: inlinedHtml, attachments: regularAttachments } = inlineCidImages(html, attachments);

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'api-key': env.brevo.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.brevo.senderEmail, name: env.brevo.senderName },
      to: toBrevoRecipients(to),
      subject,
      htmlContent: inlinedHtml,
      textContent: text,
      replyTo: replyTo ? { email: replyTo } : undefined,
      attachment: toBrevoAttachments(regularAttachments),
    }),
  });

  if (!res.ok) {
    // Brevo's own error body — logged here for real server-side diagnostics
    // (recipient + status make it greppable), and also carried on the
    // thrown Error for callers that persist a per-recipient failure reason
    // (Marketing Center's markRecipientFailed). Never the api-key itself —
    // that's a request header, never part of this response body.
    // middleware/errorHandler.js's generic 500 branch never forwards
    // err.message to the client either way, so a caller that just lets this
    // propagate (e.g. requestLoginOtp) still only ever shows the existing
    // {error:'internal_error', message:'Something went wrong'} public shape.
    const body = await res.text().catch(() => '');
    console.error(`[email.service] Brevo send failed (${res.status}) to ${to}: ${body.slice(0, 500)}`);
    throw new Error(`Brevo email send failed (${res.status})`);
  }

  return { delivered: true, logged: false };
}

module.exports.sendEmail = sendEmail;

async function sendOtpEmail(email, otp, expiresInMinutes) {
  const { html, attachments } = buildOtpEmailHtml({ otp, expiresInMinutes });
  return sendEmail({
    to: email,
    subject: 'Your Xclusive Oman sign-in code',
    text: `Your Xclusive Oman sign-in code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
    html,
    attachments,
  });
}

module.exports.sendOtpEmail = sendOtpEmail;
