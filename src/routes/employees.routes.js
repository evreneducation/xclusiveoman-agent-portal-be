import { Router } from 'express';
import * as employeesController from '../controllers/employees.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, patchGenericEmployeeSchema } from '../validation/schemas.js';

const router = Router();

// Same HR-adjacent, super_admin-only gate as /admin/relationship-managers,
// /admin/sales-managers, and /admin/employees/custom-role.
router.use(requireAuth, requireRole('super_admin'));

router.get('/roles', employeesController.listRoles);
router.get('/', employeesController.list);
router.patch('/:id', validateBody(patchGenericEmployeeSchema), employeesController.update);

export default router;
