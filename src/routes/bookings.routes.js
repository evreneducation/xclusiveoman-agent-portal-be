import { Router } from 'express';
import * as bookingsController from '../controllers/bookings.controller.js';
import * as documentsAgentController from '../controllers/travelerDocumentsAgent.controller.js';
import * as reviewsAgentController from '../controllers/reviewsAgent.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validateBody, submitReviewSchema } from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/', bookingsController.listMyBookings);
router.get('/:id', bookingsController.getBooking);

// --- Traveler Document Upload (Task 14 — Screen 23, DOC-1/DOC-6) ---
router.get('/:id/documents', documentsAgentController.getDocuments);
router.post(
  '/:id/travelers/:travelerId/documents',
  upload.fields([
    { name: 'passportScan', maxCount: 1 },
    { name: 'passportPhoto', maxCount: 1 },
  ]),
  documentsAgentController.uploadDocuments
);
router.get('/:id/travelers/:travelerId/documents/:type/download', documentsAgentController.downloadTravelerDocument);
router.get('/:id/voucher/download', documentsAgentController.downloadVoucher);

// --- Review & Rating Popup (Task 20 — Screen 32, REV-2) ---
router.post('/:id/review', validateBody(submitReviewSchema), reviewsAgentController.submitReview);
router.post('/:id/dismiss-review-prompt', reviewsAgentController.dismissReviewPrompt);

export default router;
