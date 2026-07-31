import { Router } from 'express';
import * as agenciesController from '../controllers/agencies.controller.js';
import * as paymentsController from '../controllers/payments.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, patchAgencyMeSchema, createSubUserSchema } from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/me', agenciesController.getMyAgency);
router.get('/me/transactions', paymentsController.getMyTransactions);
router.patch('/me', requireRole('agency_owner'), validateBody(patchAgencyMeSchema), agenciesController.patchMyAgency);
router.get('/me/users', requireRole('agency_owner'), agenciesController.listMySubUsers);
router.post(
  '/me/users',
  requireRole('agency_owner'),
  validateBody(createSubUserSchema),
  agenciesController.createSubUser
);

export default router;
