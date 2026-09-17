const {
  Router
} = require('express');

const customRoleEmployeesController = require('../controllers/customRoleEmployees.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  createCustomRoleEmployeeSchema
} = require('../validation/schemas.js');

const router = Router();

// Same HR-adjacent, super_admin-only gate as /admin/relationship-managers
// and /admin/sales-managers.
router.use(requireAuth, requireRole('super_admin'));

router.post('/', validateBody(createCustomRoleEmployeeSchema), customRoleEmployeesController.create);

module.exports = router;
