const {
  Router
} = require('express');

const {
  requireAuth,
  requireRole,
  STAFF_ROLES
} = require('../middleware/auth.js');

const {
  validateBody,
  totpCodeSchema
} = require('../validation/schemas.js');

const {
  mfaVerifyLimiter
} = require('../middleware/rateLimiter.js');

const {
  getSecurityStatus,
  beginTotpEnrollment,
  activateTotp,
  disableTotp
} = require('../controllers/adminSecurity.controller.js');

// Admin console "Security" screen (admin/pages/Security.jsx) — one GLOBAL
// authenticator-app (TOTP) toggle guarding every admin-console sign-in.
// Mounted at the full '/admin/security' prefix in routes/index.js, ahead of
// the bare-'/admin' routers, same "specific prefix first" convention every
// other '/admin/<x>' router follows there.
const router = Router();

router.use(requireAuth);

// Reading the current on/off state is open to any staff role so the page
// renders for everyone; the mutations below are super_admin-only.
router.get('/', requireRole(...STAFF_ROLES), getSecurityStatus);

router.use(requireRole('super_admin'));
// enroll/activate/disable all check a live 6-digit code — same brute-force
// surface as the login step, so the same IP throttle applies.
router.post('/totp/enroll', mfaVerifyLimiter, beginTotpEnrollment);
router.post('/totp/activate', mfaVerifyLimiter, validateBody(totpCodeSchema), activateTotp);
router.post('/totp/disable', mfaVerifyLimiter, validateBody(totpCodeSchema), disableTotp);

module.exports = router;
