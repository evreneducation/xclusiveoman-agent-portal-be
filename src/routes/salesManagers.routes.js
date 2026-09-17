const {
  Router
} = require('express');

const salesManagersController = require('../controllers/salesManagers.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  createSalesManagerSchema,
  patchSalesManagerSchema
} = require('../validation/schemas.js');

const router = Router();

// Creating/managing the sales manager pool is HR-adjacent, same super_admin
// gate as /admin/relationship-managers.
router.use(requireAuth, requireRole('super_admin'));

router.get('/', salesManagersController.list);
router.post('/', validateBody(createSalesManagerSchema), salesManagersController.create);
router.patch('/:id', validateBody(patchSalesManagerSchema), salesManagersController.update);

module.exports = router;
