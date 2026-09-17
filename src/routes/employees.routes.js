const {
  Router
} = require('express');

const employeesController = require('../controllers/employees.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  patchGenericEmployeeSchema
} = require('../validation/schemas.js');

const router = Router();

// Same HR-adjacent, super_admin-only gate as /admin/relationship-managers,
// /admin/sales-managers, and /admin/employees/custom-role.
router.use(requireAuth, requireRole('super_admin'));

router.get('/roles', employeesController.listRoles);
router.get('/', employeesController.list);
router.patch('/:id', validateBody(patchGenericEmployeeSchema), employeesController.update);

module.exports = router;
