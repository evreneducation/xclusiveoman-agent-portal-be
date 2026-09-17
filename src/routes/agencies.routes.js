const {
  Router
} = require('express');

const agenciesController = require('../controllers/agencies.controller.js');
const paymentsController = require('../controllers/payments.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  patchAgencyMeSchema,
  createSubUserSchema
} = require('../validation/schemas.js');

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/me', agenciesController.getMyAgency);
router.get('/me/transactions', paymentsController.getMyTransactions);
router.patch('/me', requireRole('agency_owner'), validateBody(patchAgencyMeSchema), agenciesController.patchMyAgency);
router.get('/me/users', requireRole('agency_owner'), agenciesController.listMySubUsers);
router.post(
  '/me/users',
  requireRole('agency_owner'),
  validateBody(createSubUserSchema),
  agenciesController.createSubUser
);

module.exports = router;
