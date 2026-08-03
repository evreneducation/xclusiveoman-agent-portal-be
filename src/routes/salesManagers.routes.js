import { Router } from 'express';
import * as salesManagersController from '../controllers/salesManagers.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateBody,
  createSalesManagerSchema,
  patchSalesManagerSchema,
} from '../validation/schemas.js';

const router = Router();

// Creating/managing the sales manager pool is HR-adjacent, same super_admin
// gate as /admin/relationship-managers.
router.use(requireAuth, requireRole('super_admin'));

router.get('/', salesManagersController.list);
router.post('/', validateBody(createSalesManagerSchema), salesManagersController.create);
router.patch('/:id', validateBody(patchSalesManagerSchema), salesManagersController.update);

export default router;
