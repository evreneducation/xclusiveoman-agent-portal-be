const {
  Router
} = require('express');

const authController = require('../controllers/auth.controller.js');

const {
  requireAuth
} = require('../middleware/auth.js');

const {
  otpRequestLimiter,
  mfaVerifyLimiter,
  adminLoginLimiter
} = require('../middleware/rateLimiter.js');

const {
  upload
} = require('../middleware/upload.js');

const {
  validateBody,
  registerSchema,
  requestOtpSchema,
  verifyOtpSchema,
  verifyMfaSchema,
  adminLoginSchema
} = require('../validation/schemas.js');

const router = Router();

// Public, unauthenticated — mirrors register itself, which also runs before
// any account exists. Must be registered ahead of the Sign Up form's final
// submit so the resulting URL can be included in the /register JSON body
// (registerSchema now requires licenseDocumentUrl).
router.post('/register/license-document', upload.single('licenseDocument'), authController.uploadLicenseDocument);
router.post('/register', validateBody(registerSchema), authController.register);
// Email OTP is Agent/Team's sign-in mechanism — no per-user password
// anywhere (users.password_hash dropped, 0060_drop_password.sql). The
// original /login, /forgot-password, /reset-password were removed along
// with it, not just left dormant, since the column they depended on no
// longer exists. otpRequestLimiter runs before validateBody so a flood of
// malformed bodies is throttled too, not just well-formed ones.
router.post('/request-otp', otpRequestLimiter, validateBody(requestOtpSchema), authController.requestLoginOtp);
router.post('/verify-otp', validateBody(verifyOtpSchema), authController.verifyLoginOtp);
// Admin console 2FA step 3 (only reached when the global authenticator
// toggle is on) — reachable from either verify-otp above or admin-login
// below. mfaVerifyLimiter throttles brute-forcing the 6-digit code by IP,
// same posture otpRequestLimiter takes on the send step above.
router.post('/verify-mfa', mfaVerifyLimiter, validateBody(verifyMfaSchema), authController.verifyLoginMfa);
// Admin Console login — email + a per-account bcrypt password
// (users.password_hash, 0084_admin_password.sql), not OTP. adminLoginLimiter
// throttles brute-forcing by IP, same posture as the two limiters above.
router.post('/admin-login', adminLoginLimiter, validateBody(adminLoginSchema), authController.adminLogin);
router.post('/refresh', authController.refresh);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

module.exports = router;
