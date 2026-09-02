import { Router } from 'express';
import * as bookingsAdminController from '../controllers/bookingsAdmin.controller.js';
import * as documentsAdminController from '../controllers/travelerDocumentsAdmin.controller.js';
import { requireAuth, requireRole, requireFeature } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validateBody, manualBookingSchema, emailToSupplierSchema } from '../validation/schemas.js';
import { findBookingDetailForAdmin } from '../models/bookingsAdmin.model.js';
import { listAgenciesByRmIds } from '../models/agencies.model.js';

const router = Router();

// Admin Bookings & Documents — Manual Booking Flow (Task 13 — Screen 22) and
// Client Documents & Visa Processing (Task 14 — Screen 23). One router, one
// RBAC gate, independent of Marketing's and Operations' — same
// ops_admin/super_admin convention Task 12 established for every other
// admin write-heavy feature the documentation marks "ops_admin+" (§12.7/12.8
// mark both Manual Booking and Documents & Visa this way). Widened to also
// admit sales_manager/relationship_manager (the Team Portal's Bookings &
// Docs Access Feature) — requireFeature('bookingsDocs') below is what
// actually gates them: an LM/RM without that checkbox checked still 403s
// here exactly like any other STAFF_ROLE without ops_admin/super_admin used
// to.
router.use(requireAuth, requireRole('ops_admin', 'super_admin', 'sales_manager', 'relationship_manager'));
router.use(requireFeature('bookingsDocs'));

// A Relationship Manager only ever sees bookings/documents for their own
// assigned agencies (agencies.rm_user_id) — same "by his record" scoping as
// Approved Agents (admin.controller.js#getAgencies). Never applies to an LM
// or ops_admin/super_admin: Bookings & Docs has no per-LM concept the way
// Quotes & Pricing does (no lead_manager_user_id on bookings), so an LM with
// this checkbox sees the same full list any ops_admin does.
async function scopeToOwnAgencyBooking(req, res, next) {
  if (req.user.role !== 'relationship_manager') return next();
  try {
    const booking = await findBookingDetailForAdmin(req.params.id);
    if (!booking) return res.status(404).json({ error: 'not_found' });
    const own = await listAgenciesByRmIds([req.user.id]);
    if (!own.some((a) => a.id === booking.agency_id)) {
      return res.status(404).json({ error: 'not_found' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/', bookingsAdminController.listBookings);
router.post('/manual', validateBody(manualBookingSchema), bookingsAdminController.createManualBooking);

// --- Booking & Visa Processing (Task 14, DOC-2..6) ---
router.get('/:id/documents', scopeToOwnAgencyBooking, documentsAdminController.getDocuments);
router.get('/:id/documents/download-all', scopeToOwnAgencyBooking, documentsAdminController.downloadAllZip);
router.post('/:id/documents/email-to-supplier', scopeToOwnAgencyBooking, validateBody(emailToSupplierSchema), documentsAdminController.emailToSupplier);
// No POST /:id/documents/notify-agent route — uploadVisaCopy/uploadVoucher
// below now unlock and notify automatically (see their own comments in
// travelerDocumentsAdmin.controller.js), no separate manual release step.
router.get('/:id/travelers/:travelerId/documents/:type/download', scopeToOwnAgencyBooking, documentsAdminController.downloadTravelerDocument);
router.post('/:id/travelers/:travelerId/visa-copy', scopeToOwnAgencyBooking, upload.single('visaCopy'), documentsAdminController.uploadVisaCopy);
router.get('/:id/voucher/download', scopeToOwnAgencyBooking, documentsAdminController.downloadVoucher);
router.post('/:id/voucher', scopeToOwnAgencyBooking, upload.single('voucher'), documentsAdminController.uploadVoucher);

export default router;
