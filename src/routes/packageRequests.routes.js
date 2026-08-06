import { Router } from 'express';
import * as packageRequestsController from '../controllers/packageRequests.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateBody,
  createPackageRequestSchema,
  draftPackageRequestSchema,
  respondPackageRequestSchema,
} from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

// "My FIT Requests / Quotes" (items 1/2/8).
router.get('/', packageRequestsController.list);
router.post('/', validateBody(createPackageRequestSchema), packageRequestsController.create);

// Draft Quotes (item 1) — registered before '/:id' so '/draft' isn't
// swallowed by the param route.
router.post('/draft', validateBody(draftPackageRequestSchema), packageRequestsController.createDraft);

router.get('/:id', packageRequestsController.get);
router.patch('/:id', validateBody(draftPackageRequestSchema), packageRequestsController.updateDraft);
router.delete('/:id', packageRequestsController.remove);
router.post('/:id/submit', validateBody(createPackageRequestSchema), packageRequestsController.submit);

// Agent Actions on a Published quote (item 5).
router.post('/:id/respond', validateBody(respondPackageRequestSchema), packageRequestsController.respond);

export default router;
