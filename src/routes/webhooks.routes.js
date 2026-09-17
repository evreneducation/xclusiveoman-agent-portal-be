const {
  Router
} = require('express');

const express = require('express');
const paymentsController = require('../controllers/payments.controller.js');

const router = Router();

// Cashfree needs the exact raw body bytes to verify the signature (doc §14.1/§16),
// so this route is mounted ahead of the global express.json() parser in app.js.
router.post('/cashfree', express.raw({ type: '*/*' }), paymentsController.cashfreeWebhook);

module.exports = router;
