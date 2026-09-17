const {
  Router
} = require('express');

const marketingController = require('../controllers/marketing.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  createMarketingCampaignSchema,
  scheduleMarketingCampaignSchema,
  sendMarketingTestSchema
} = require('../validation/schemas.js');

const router = Router();

// Sending real campaign email is sensitive (agency-facing, outward-bound) —
// same super_admin-or-owning-role gate as the other write-heavy admin
// features (e.g. relationship-managers, sales-managers). Marketing Center's
// own role, plus super_admin as the usual override. Every route below
// (Task 5's send-test/campaigns and Task 6's schedule/cancel) inherits this
// same gate — no separate RBAC concept for scheduling.
router.use(requireAuth, requireRole('sales_marketing', 'super_admin'));

router.post('/send-test', validateBody(sendMarketingTestSchema), marketingController.sendTest);
router.post('/campaigns', validateBody(createMarketingCampaignSchema), marketingController.createCampaign);
router.post('/campaigns/schedule', validateBody(scheduleMarketingCampaignSchema), marketingController.scheduleCampaign);
router.post('/campaigns/:id/cancel', marketingController.cancelCampaign);

// Campaign History (Task 7) — read-only, same requireAuth/requireRole gate
// above as every other route in this router.
router.get('/campaigns', marketingController.listCampaigns);
router.get('/campaigns/:id', marketingController.getCampaign);
router.get('/campaigns/:id/recipients', marketingController.listCampaignRecipients);

// Channel Settings (Task 9) — same gate; both routes are read-only/diagnostic
// (no provider configuration is ever written by either).
router.get('/channels', marketingController.getChannels);
router.post('/channels/:provider/test-connection', marketingController.testChannelConnection);

module.exports = router;
