import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { requireAuth, requireRole, STAFF_ROLES } from '../middleware/auth.js';
import { validateBody, patchAdminAgencySchema } from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole(...STAFF_ROLES));

// Any staff role can view agencies (ops_admin+ per doc §12.2), only super_admin can decide.
router.get('/agencies', adminController.getAgencies);
router.patch(
  '/agencies/:id',
  requireRole('super_admin'),
  validateBody(patchAdminAgencySchema),
  adminController.patchAgency
);

export default router;
