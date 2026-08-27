import { Router } from 'express';
import * as paymentsController from '../controllers/payments.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validateBody } from '../validation/schemas.js';
import { z } from 'zod';

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

export default router;

// Admin-facing (finance/ops_admin+), mounted at /api/admin from routes/index.js.
export const adminPaymentsRouter = Router();
adminPaymentsRouter.use(requireAuth, requireRole('finance', 'ops_admin', 'super_admin'));

adminPaymentsRouter.get('/neft-verifications', paymentsController.getNeftPending);
adminPaymentsRouter.post('/payments/:id/verify', paymentsController.verifyNeftPayment);
adminPaymentsRouter.get('/transactions', paymentsController.getAllTransactions);
