import { Router } from 'express';
import * as reviewsAgentController from '../controllers/reviewsAgent.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// Agent Review & Rating Popup (Task 20 — Screen 32) — same existing
// agency_owner/agency_staff gate every other agent-facing router uses.
// Mounted at /api/reviews, matching the doc's own bare route naming
// (§12.10: "GET /reviews/pending-prompt").
router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/pending-prompt', reviewsAgentController.listPendingPrompts);

export default router;
