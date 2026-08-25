import { Router } from 'express';
import * as customRoleEmployeesController from '../controllers/customRoleEmployees.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, createCustomRoleEmployeeSchema } from '../validation/schemas.js';

const router = Router();

// Same HR-adjacent, super_admin-only gate as /admin/relationship-managers
// and /admin/sales-managers.
router.use(requireAuth, requireRole('super_admin'));

router.post('/', validateBody(createCustomRoleEmployeeSchema), customRoleEmployeesController.create);

export default router;
