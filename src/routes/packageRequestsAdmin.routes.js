import { Router } from 'express';
import * as controller from '../controllers/packageRequestsAdmin.controller.js';
import { requireAuth, requireRole, STAFF_ROLES } from '../middleware/auth.js';
import { validateBody, assignPackageRequestLeadManagerSchema, packageRequestCostingSchema } from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole(...STAFF_ROLES));

// Registered before '/:id' so it isn't swallowed by the param route.
router.get('/lead-manager-candidates', controller.listLeadManagerCandidates);

router.get('/', controller.list);
router.get('/:id', controller.get);
router.patch('/:id/lead-manager', validateBody(assignPackageRequestLeadManagerSchema), controller.assignLeadManager);
// Costing & Quote Publishing (Quote Details, continuing from Selected Extras).
router.patch('/:id/costing', validateBody(packageRequestCostingSchema), controller.saveCosting);
router.post('/:id/publish', controller.publish);

export default router;
