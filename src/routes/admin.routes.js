import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { requireAuth, requireRole, requireFeature, STAFF_ROLES } from '../middleware/auth.js';
import { validateBody, patchAdminAgencySchema } from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole(...STAFF_ROLES));

// Any staff role can view agencies (ops_admin+ per doc §12.2), only super_admin can decide.
// requireFeature('approvedAgents') only ever narrows sales_manager/
// relationship_manager (see its own doc comment) — an LM has no
// 'approvedAgents' key in LM_FEATURE_KEYS at all, so this correctly 403s
// every LM regardless of their other Access Features; an RM sees only their
// own book (getAgencies' own req.user.role === 'relationship_manager' scoping).
router.get('/agencies', requireFeature('approvedAgents'), adminController.getAgencies);
router.patch(
  '/agencies/:id',
  requireRole('super_admin'),
  validateBody(patchAdminAgencySchema),
  adminController.patchAgency
);

export default router;
