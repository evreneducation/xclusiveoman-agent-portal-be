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

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.use('/auth', authRoutes);
router.use('/agencies', agenciesRoutes);
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
// Public, no requireAuth — Task 11 (Open & Click Tracking). See
// marketingTracking.routes.js's own comment for why this is the one
// deliberate exception to every other Marketing route staying protected.
router.use('/marketing/track', marketingTrackingRoutes);
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
router.use('/departure-locations', locationsRoutes);
router.use('/notifications', notificationsRoutes);

export default router;
