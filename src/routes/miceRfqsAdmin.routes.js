import { Router } from 'express';
import { z } from 'zod';
import * as controller from '../controllers/miceRfqsAdmin.controller.js';
import { requireAuth, requireRole, requireFeature, STAFF_ROLES } from '../middleware/auth.js';
import { validateBody, assignMiceRfqLeadManagerSchema, miceRfqCostingSchema, itinerarySchema } from '../validation/schemas.js';

const router = Router();

// requireFeature('quotesPricing') — same Team Portal Access Feature as
// packageRequestsAdmin.routes.js; scoping for LM/RM lives in the controller.
router.use(requireAuth, requireRole(...STAFF_ROLES), requireFeature('quotesPricing'));

// Registered before '/:id' so it isn't swallowed by the param route.
router.get('/lead-manager-candidates', controller.listLeadManagerCandidates);

router.get('/', controller.list);
router.get('/:id', controller.get);
router.patch('/:id/lead-manager', validateBody(assignMiceRfqLeadManagerSchema), controller.assignLeadManager);
// Costing & Markup Panel (continuing from Request Detail).
router.patch('/:id/costing', validateBody(miceRfqCostingSchema), controller.saveCosting);
// Day-wise Itinerary Planner — admin edit, same shape the agent builder
// sends ({ days: [...] }), mirroring package-requests' itinerary PATCH.
router.patch('/:id/itinerary', validateBody(z.object({ days: itinerarySchema })), controller.saveItinerary);
router.post('/:id/publish', controller.publish);

export default router;
