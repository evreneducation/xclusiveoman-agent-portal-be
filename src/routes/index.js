import { Router } from 'express';
import authRoutes from './auth.routes.js';
import agenciesRoutes from './agencies.routes.js';
import adminRoutes from './admin.routes.js';
import catalogRoutes, { adminCatalogRouter } from './catalog.routes.js';
import departuresRoutes from './departures.routes.js';
import packageRequestsRoutes from './packageRequests.routes.js';
import packageRequestsAdminRoutes from './packageRequestsAdmin.routes.js';
import itineraryPdfDataRoutes from './itineraryPdfData.routes.js';
import miceRfqsRoutes from './miceRfqs.routes.js';
import miceRfqsAdminRoutes from './miceRfqsAdmin.routes.js';
import fdPackagesAdminRoutes from './fdPackagesAdmin.routes.js';
import paymentsRoutes, { adminPaymentsRouter } from './payments.routes.js';
import bookingsRoutes from './bookings.routes.js';
import relationshipManagersRoutes from './relationshipManagers.routes.js';
import salesManagersRoutes from './salesManagers.routes.js';
import locationsRoutes from './locations.routes.js';
import notificationsRoutes from './notifications.routes.js';
import marketingRoutes from './marketing.routes.js';
import marketingTrackingRoutes from './marketingTracking.routes.js';
import fdOperationsAdminRoutes from './fdOperationsAdmin.routes.js';
import bookingsAdminRoutes from './bookingsAdmin.routes.js';
import supportTicketsRoutes from './supportTickets.routes.js';
import supportTicketsAdminRoutes from './supportTicketsAdmin.routes.js';
import analyticsRoutes from './analytics.routes.js';
import reviewsRoutes from './reviews.routes.js';
import cmsRoutes from './cms.routes.js';
import cmsPublicRoutes from './cmsPublic.routes.js';

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.use('/auth', authRoutes);
router.use('/agencies', agenciesRoutes);
// Admin Support & Helpdesk (Task 18) — mounted at the more specific
// /admin/support/tickets prefix, and deliberately registered BEFORE the
// bare-/admin routers below. adminRoutes/adminCatalogRouter/adminPaymentsRouter
// each apply their own blanket requireRole(...) to every request that
// matches the bare /admin prefix — including paths with no route defined in
// them at all — so if any of those routers' own role gate doesn't include
// 'support' (adminPaymentsRouter's is finance/ops_admin/super_admin), a
// support-role request to /admin/support/tickets/... would be rejected by
// that unrelated router before Express ever reaches this one. Registering
// the more specific prefix first avoids that entirely; no other router's
// code or behavior changes.
router.use('/admin/support/tickets', supportTicketsAdminRoutes);
// Admin Analytics & Reporting (Task 19) — same "specific prefix before the
// bare /admin routers" ordering as Support above, for the same reason
// (defensive — ops_admin/super_admin already pass every earlier router's
// own gate today, but this keeps the convention consistent and correct
// regardless of what any of those gates allow in the future).
router.use('/admin/analytics', analyticsRoutes);
// Admin Content & CMS Management (Task 21 — Item 34) — its own RBAC gate
// (super_admin only, narrower than every other /admin/* router — see
// cms.routes.js), registered before the bare-/admin routers below for the
// same reason Support/Analytics are: those routers' own blanket
// requireRole(...) would otherwise reject a matching-prefix request before
// Express ever reaches this one.
router.use('/admin/cms', cmsRoutes);
router.use('/admin', adminRoutes);
router.use('/admin', adminCatalogRouter);
router.use('/admin', adminPaymentsRouter);
router.use('/admin/fd-packages', fdPackagesAdminRoutes);
router.use('/admin/relationship-managers', relationshipManagersRoutes);
router.use('/admin/sales-managers', salesManagersRoutes);
router.use('/admin/marketing', marketingRoutes);
// FD Operations Tracker (Task 12) — its own RBAC gate (ops_admin/super_admin),
// separate from Marketing's above; see fdOperationsAdmin.routes.js.
router.use('/admin/operations', fdOperationsAdminRoutes);
// Admin Bookings & Documents — Manual Booking Flow (Task 13) — its own RBAC
// gate too (ops_admin/super_admin); see bookingsAdmin.routes.js.
router.use('/admin/bookings', bookingsAdminRoutes);
router.use('/support/tickets', supportTicketsRoutes);
// Public, no requireAuth — Task 11 (Open & Click Tracking). See
// marketingTracking.routes.js's own comment for why this is the one
// deliberate exception to every other Marketing route staying protected.
router.use('/marketing/track', marketingTrackingRoutes);
// Public CMS Page Viewer (Task 21 — Item 34 continuation) — deliberately no
// requireAuth, same "one documented public exception" pattern as
// /marketing/track just above. Entirely separate from /admin/cms
// (cmsRoutes, still super_admin only, untouched) — see
// cmsPublic.routes.js's own comment.
router.use('/cms', cmsPublicRoutes);
router.use('/', catalogRoutes);
router.use('/departures', departuresRoutes);
router.use('/package-requests', packageRequestsRoutes);
router.use('/admin/package-requests', packageRequestsAdminRoutes);
// pdfToken-authenticated (not requireAuth) — see itineraryPdfData.routes.js.
router.use('/itinerary-pdf', itineraryPdfDataRoutes);
router.use('/mice/rfqs', miceRfqsRoutes);
router.use('/admin/mice-rfqs', miceRfqsAdminRoutes);
router.use('/payments', paymentsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/departure-locations', locationsRoutes);
router.use('/notifications', notificationsRoutes);

export default router;
