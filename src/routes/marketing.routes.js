import { Router } from 'express';
import * as marketingController from '../controllers/marketing.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateBody,
  createMarketingCampaignSchema,
  scheduleMarketingCampaignSchema,
  sendMarketingTestSchema,
} from '../validation/schemas.js';

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

export default router;
