const {
  Router
} = require('express');

const paymentsController = require('../controllers/payments.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  upload
} = require('../middleware/upload.js');

const {
  validateBody
} = require('../validation/schemas.js');

const {
  z
} = require('zod');

const createOrderSchema = z.object({
  bookingId: z.string().uuid(),
  amount: z.number().positive(),
  // Per-"Pay"-click idempotency key minted by the frontend and replayed on
  // network retry (spec C). Optional so the endpoint stays backward
  // compatible; the agent portal always sends it.
  clientAttemptToken: z.string().uuid().optional(),
});

// Agent-facing (doc §12.9), mounted at /api/payments.
const router = Router();
router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.post('/cashfree/create-order', validateBody(createOrderSchema), paymentsController.createCashfreeOrder);
// Reconciliation / polling (spec G, I). `by-order` is declared before the
// `/:id` param route so it isn't captured as an id.
router.get('/by-order/:orderId', paymentsController.getPaymentByOrder);
router.get('/:id', paymentsController.getPaymentStatus);
router.post('/:id/abort', paymentsController.abortPayment);
router.post('/:bookingId/neft-slip', upload.single('slip'), paymentsController.uploadNeftSlip);

module.exports = router;
const adminPaymentsRouter = Router();
module.exports.adminPaymentsRouter = adminPaymentsRouter;
adminPaymentsRouter.use(requireAuth, requireRole('finance', 'ops_admin', 'super_admin'));

adminPaymentsRouter.get('/neft-verifications', paymentsController.getNeftPending);
adminPaymentsRouter.post('/payments/:id/verify', paymentsController.verifyNeftPayment);
adminPaymentsRouter.get('/transactions', paymentsController.getAllTransactions);
