import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { otpRequestLimiter, mfaVerifyLimiter } from '../middleware/rateLimiter.js';
import { upload } from '../middleware/upload.js';
import { validateBody, registerSchema, requestOtpSchema, verifyOtpSchema, verifyMfaSchema } from '../validation/schemas.js';

const router = Router();

// Public, unauthenticated — mirrors register itself, which also runs before
// any account exists. Must be registered ahead of the Sign Up form's final
// submit so the resulting URL can be included in the /register JSON body
// (registerSchema now requires licenseDocumentUrl).
router.post('/register/license-document', upload.single('licenseDocument'), authController.uploadLicenseDocument);
router.post('/register', validateBody(registerSchema), authController.register);
// Email OTP is the sole sign-in mechanism — no password anywhere
// (users.password_hash dropped, 0060_drop_password.sql). /login,
// /forgot-password, /reset-password removed along with it, not just
// left dormant, since the column they depended on no longer exists.
// otpRequestLimiter runs before validateBody so a flood of malformed
// bodies is throttled too, not just well-formed ones.
router.post('/request-otp', otpRequestLimiter, validateBody(requestOtpSchema), authController.requestLoginOtp);
router.post('/verify-otp', validateBody(verifyOtpSchema), authController.verifyLoginOtp);
// Admin console 2FA step 3 (only reached when the global authenticator
// toggle is on). mfaVerifyLimiter throttles brute-forcing the 6-digit code
// by IP, same posture otpRequestLimiter takes on the send step above.
router.post('/verify-mfa', mfaVerifyLimiter, validateBody(verifyMfaSchema), authController.verifyLoginMfa);
router.post('/refresh', authController.refresh);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

export default router;
