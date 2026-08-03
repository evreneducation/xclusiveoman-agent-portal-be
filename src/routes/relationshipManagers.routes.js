import { Router } from 'express';
import * as relationshipManagersController from '../controllers/relationshipManagers.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateBody,
  createRelationshipManagerSchema,
  patchRelationshipManagerSchema,
} from '../validation/schemas.js';

const router = Router();

// Creating/managing the RM pool is HR-adjacent, same super_admin gate as /admin/sales-managers.
router.use(requireAuth, requireRole('super_admin'));

router.get('/', relationshipManagersController.list);
router.post('/', validateBody(createRelationshipManagerSchema), relationshipManagersController.create);
router.patch('/:id', validateBody(patchRelationshipManagerSchema), relationshipManagersController.update);

export default router;
