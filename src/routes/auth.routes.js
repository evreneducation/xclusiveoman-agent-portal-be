import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, registerSchema, requestOtpSchema, verifyOtpSchema } from '../validation/schemas.js';

const router = Router();

router.post('/register', validateBody(registerSchema), authController.register);
// Email OTP is the sole sign-in mechanism — no password anywhere
// (users.password_hash dropped, 0060_drop_password.sql). /login,
// /forgot-password, /reset-password removed along with it, not just
// left dormant, since the column they depended on no longer exists.
router.post('/request-otp', validateBody(requestOtpSchema), authController.requestLoginOtp);
router.post('/verify-otp', validateBody(verifyOtpSchema), authController.verifyLoginOtp);
router.post('/refresh', authController.refresh);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

export default router;
