import { Router } from 'express';
import * as packageRequestsController from '../controllers/packageRequests.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, createPackageRequestSchema } from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.post('/', validateBody(createPackageRequestSchema), packageRequestsController.create);
router.get('/:id', packageRequestsController.get);

export default router;
