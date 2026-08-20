import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/packageRequestsAdmin.controller.js';
import { requireAuth, requireRole, requireFeature, STAFF_ROLES } from '../middleware/auth.js';
import {
  validateBody,
  assignPackageRequestLeadManagerSchema,
  packageRequestCostingSchema,
  itinerarySchema,
} from '../validation/schemas.js';

const router = Router();

// requireFeature('quotesPricing') — Team Portal Access Feature shared by
// both LM and RM (config/accessFeatures.js); the controller itself further
// scopes what each of them actually sees/can write (list/get/write-endpoint
// scoping — see packageRequestsAdmin.controller.js's own comments).
router.use(requireAuth, requireRole(...STAFF_ROLES), requireFeature('quotesPricing'));

// Registered before '/:id' so it isn't swallowed by the param route.
router.get('/lead-manager-candidates', controller.listLeadManagerCandidates);

router.get('/', controller.list);
router.get('/:id', controller.get);
router.patch('/:id/lead-manager', validateBody(assignPackageRequestLeadManagerSchema), controller.assignLeadManager);
// Costing & Quote Publishing (Quote Details, continuing from Selected Extras).
router.patch('/:id/costing', validateBody(packageRequestCostingSchema), controller.saveCosting);
// Day-wise Itinerary Planner (FIT-5) — admin edit, same shape the agent
// builder sends ({ days: [...] }), mirroring the FD package itinerary PUT.
router.patch('/:id/itinerary', validateBody(z.object({ days: itinerarySchema })), controller.saveItinerary);
router.post('/:id/publish', controller.publish);

export default router;
