const {
  Router
} = require('express');

const relationshipManagersController = require('../controllers/relationshipManagers.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  createRelationshipManagerSchema,
  patchRelationshipManagerSchema
} = require('../validation/schemas.js');

const router = Router();

// Creating/managing the RM pool is HR-adjacent, same super_admin gate as /admin/sales-managers.
router.use(requireAuth, requireRole('super_admin'));

router.get('/', relationshipManagersController.list);
router.post('/', validateBody(createRelationshipManagerSchema), relationshipManagersController.create);
router.patch('/:id', validateBody(patchRelationshipManagerSchema), relationshipManagersController.update);

module.exports = router;
