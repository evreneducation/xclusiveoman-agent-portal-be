import QRCode from 'qrcode';
import { adminSecurityModel } from '../models/adminSecurity.model.js';
import { generateSecret, verifyTotpStep, buildOtpAuthUri } from '../services/totp.service.js';

// The admin console's "Security" screen (admin/pages/Security.jsx). One
// GLOBAL authenticator-app (TOTP) toggle — not per-user enrolment — so
// these endpoints operate on the single admin_security row. Read is open to
// any staff role so the page can render its current state; the three
// mutations are super_admin-only (see adminSecurity.routes.js), since
// flipping this affects every admin's ability to sign in.

const TOTP_ISSUER = 'Xclusive Oman';
const TOTP_LABEL = 'Admin Console';

function toStatus(row) {
  return {
    twoFactor: {
      // The real switch the login flow reads.
      enabled: Boolean(row?.totp_enabled),
      // A secret exists (enrolment started) but isn't confirmed yet — lets
      // the UI tell "never set up" apart from "half-way through setup".
      pending: Boolean(row && row.totp_secret && !row.totp_enabled),
    },
  };
}

// GET /admin/security
export async function getSecurityStatus(req, res, next) {
  try {
    const row = await adminSecurityModel.get();
    res.json(toStatus(row));
  } catch (err) {
    next(err);
  }
}

// POST /admin/security/totp/enroll — generates a fresh secret, stashes it as
// pending, and returns everything the Security page needs to render the
// setup step: the otpauth:// URI, a scannable QR (data URI), and the base32
// secret for manual entry. Refuses if 2FA is already on — turning it off
// first is the deliberate path to re-key.
export async function beginTotpEnrollment(req, res, next) {
  try {
    const existing = await adminSecurityModel.get();
    if (existing?.totp_enabled) {
      return res.status(409).json({
        error: 'already_enabled',
        message: 'Two-factor authentication is already on. Turn it off first to set up a new authenticator.',
      });
    }

    const secret = generateSecret();
    await adminSecurityModel.setPendingSecret(secret);

    const otpauthUri = buildOtpAuthUri({ secret, label: TOTP_LABEL, issuer: TOTP_ISSUER });
    const qrDataUri = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });

    res.json({ secret, otpauthUri, qrDataUri });
  } catch (err) {
    next(err);
  }
}

// POST /admin/security/totp/activate — confirms the pending secret was
// actually scanned by checking a live 6-digit code against it, then flips
// the global switch on.
export async function activateTotp(req, res, next) {
  try {
    const { code } = req.body;
    const row = await adminSecurityModel.get();
    if (!row?.totp_secret || row.totp_enabled) {
      return res.status(400).json({
        error: 'no_pending_setup',
        message: 'Start the authenticator setup again — there is no pending secret to confirm.',
      });
    }
    const step = verifyTotpStep(row.totp_secret, code, row.last_totp_step);
    if (step === null) {
      return res.status(400).json({ error: 'invalid_code', message: 'That code is not valid. Enter the code your authenticator app is showing right now.' });
    }

    const updated = await adminSecurityModel.activate(step);
    res.json(toStatus(updated));
  } catch (err) {
    next(err);
  }
}

// POST /admin/security/totp/disable — turning 2FA off still requires a
// current code, so a walk-up on an already-signed-in super_admin session
// can't quietly strip protection off every other admin account.
export async function disableTotp(req, res, next) {
  try {
    const { code } = req.body;
    const row = await adminSecurityModel.get();
    if (!row?.totp_enabled) {
      return res.json(toStatus(row));
    }
    if (verifyTotpStep(row.totp_secret, code, row.last_totp_step) === null) {
      return res.status(400).json({ error: 'invalid_code', message: 'Enter the code your authenticator app is showing right now to turn 2FA off.' });
    }

    const updated = await adminSecurityModel.disable();
    res.json(toStatus(updated));
  } catch (err) {
    next(err);
  }
}
