import { Router } from 'express';
import * as bookingsAdminController from '../controllers/bookingsAdmin.controller.js';
import * as documentsAdminController from '../controllers/travelerDocumentsAdmin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validateBody, manualBookingSchema, emailToSupplierSchema } from '../validation/schemas.js';

const router = Router();

// Admin Bookings & Documents — Manual Booking Flow (Task 13 — Screen 22) and
// Client Documents & Visa Processing (Task 14 — Screen 23). One router, one
// RBAC gate, independent of Marketing's and Operations' — same
// ops_admin/super_admin convention Task 12 established for every other
// admin write-heavy feature the documentation marks "ops_admin+" (§12.7/12.8
// mark both Manual Booking and Documents & Visa this way).
router.use(requireAuth, requireRole('ops_admin', 'super_admin'));

router.get('/', bookingsAdminController.listBookings);
router.post('/manual', validateBody(manualBookingSchema), bookingsAdminController.createManualBooking);

// --- Client Documents & Visa Processing (Task 14, DOC-2..6) ---
router.get('/:id/documents', documentsAdminController.getDocuments);
router.get('/:id/documents/download-all', documentsAdminController.downloadAllZip);
router.post('/:id/documents/email-to-supplier', validateBody(emailToSupplierSchema), documentsAdminController.emailToSupplier);
router.post('/:id/documents/notify-agent', documentsAdminController.notifyAgent);
router.get('/:id/travelers/:travelerId/documents/:type/download', documentsAdminController.downloadTravelerDocument);
router.post('/:id/travelers/:travelerId/visa-copy', upload.single('visaCopy'), documentsAdminController.uploadVisaCopy);
router.get('/:id/voucher/download', documentsAdminController.downloadVoucher);
router.post('/:id/voucher', upload.single('voucher'), documentsAdminController.uploadVoucher);

export default router;
