const {
  Router
} = require('express');

const miceRfqsController = require('../controllers/miceRfqs.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  createMiceRfqSchema,
  draftMiceRfqSchema,
  respondMiceRfqSchema
} = require('../validation/schemas.js');

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

// "My MICE Requests" (items 1/2/3).
router.get('/', miceRfqsController.list);
router.post('/', validateBody(createMiceRfqSchema), miceRfqsController.create);

// MICE Drafts (item 1) — registered before '/:id' so '/draft' isn't
// swallowed by the param route.
router.post('/draft', validateBody(draftMiceRfqSchema), miceRfqsController.createDraft);

router.get('/:id', miceRfqsController.get);
router.patch('/:id', validateBody(draftMiceRfqSchema), miceRfqsController.updateDraft);
router.delete('/:id', miceRfqsController.remove);
router.post('/:id/submit', validateBody(createMiceRfqSchema), miceRfqsController.submit);

// Agent Actions on a Published proposal (item 5).
router.post('/:id/respond', validateBody(respondMiceRfqSchema), miceRfqsController.respond);

module.exports = router;
