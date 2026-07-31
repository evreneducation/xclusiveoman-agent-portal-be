import { Router } from 'express';
import express from 'express';
import * as paymentsController from '../controllers/payments.controller.js';

const router = Router();

// Cashfree needs the exact raw body bytes to verify the signature (doc §14.1/§16),
// so this route is mounted ahead of the global express.json() parser in app.js.
router.post('/cashfree', express.raw({ type: '*/*' }), paymentsController.cashfreeWebhook);

export default router;
