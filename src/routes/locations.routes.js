import { Router } from 'express';
import * as locationsController from '../controllers/locations.controller.js';
import { requireAuth, requireRole, STAFF_ROLES } from '../middleware/auth.js';
import { validateBody, departureLocationSchema } from '../validation/schemas.js';

const router = Router();

router.get('/', requireAuth, locationsController.list);
// Staff-only, unlike the GET above — an agent can read the picklist while
// building a booking but shouldn't be the one adding new master-list
// entries. Kept on this same top-level /departure-locations router rather
// than moved under /admin/* to sidestep the ordering issues those bare
// /admin routers' own blanket requireRole gates call out in routes/index.js.
router.post('/', requireAuth, requireRole(...STAFF_ROLES), validateBody(departureLocationSchema), locationsController.create);

export default router;
