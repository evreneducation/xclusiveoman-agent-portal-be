import { Router } from 'express';
import authRoutes from './auth.routes.js';
import agenciesRoutes from './agencies.routes.js';
import adminRoutes from './admin.routes.js';
import catalogRoutes, { adminCatalogRouter } from './catalog.routes.js';
import departuresRoutes from './departures.routes.js';
import packageRequestsRoutes from './packageRequests.routes.js';
import packageRequestsAdminRoutes from './packageRequestsAdmin.routes.js';
import itineraryPdfDataRoutes from './itineraryPdfData.routes.js';
import fdItineraryPdfDataRoutes from './fdItineraryPdfData.routes.js';
import miceRfqsRoutes from './miceRfqs.routes.js';
import miceRfqsAdminRoutes from './miceRfqsAdmin.routes.js';
import fdPackagesAdminRoutes from './fdPackagesAdmin.routes.js';
import paymentsRoutes, { adminPaymentsRouter } from './payments.routes.js';
import bookingsRoutes from './bookings.routes.js';
import relationshipManagersRoutes from './relationshipManagers.routes.js';
import salesManagersRoutes from './salesManagers.routes.js';
import customRoleEmployeesRoutes from './customRoleEmployees.routes.js';
import employeesRoutes from './employees.routes.js';
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
import reviewsAdminRoutes from './reviewsAdmin.routes.js';
import cmsRoutes from './cms.routes.js';
import cmsPublicRoutes from './cmsPublic.routes.js';
import siteTermsRoutes, { adminSiteTermsRouter } from './siteTerms.routes.js';
import adminSecurityRoutes from './adminSecurity.routes.js';

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
// Admin Reviews Management (Task 21 — Item 33) — its own RBAC gate
// (ops_admin/super_admin, narrower than STAFF_ROLES — see
// reviewsAdmin.routes.js), registered before the bare-/admin routers for
// the same reason as Support/Analytics/CMS above.
router.use('/admin/reviews', reviewsAdminRoutes);
// Every other router with its own more-specific /admin/<x> prefix and its
// own RBAC/Access-Feature gate — same "register before the bare-/admin
// trio" reasoning as Support/Analytics/CMS/Reviews above, just not yet
// applied here until this was traced as the actual cause of a live bug: a
// Relationship Manager/Lead Manager hitting e.g. /admin/bookings or
// /admin/package-requests was getting a 403 for the *wrong* Access Feature
// ("catalog" instead of "bookingsDocs"/"quotesPricing") because
// adminCatalogRouter below — mounted at the bare /admin prefix, with its
// own blanket requireFeature('catalog') — intercepted the request first
// and rejected it before Express ever reached these routers, exactly the
// failure mode the comment above already warned about for Support.
// FD Operations Tracker (Task 12) has its own RBAC gate
// (requireFeature('fdOperations')) — see fdOperationsAdmin.routes.js.
// Admin Bookings & Documents (Task 13) has its own RBAC gate
// (requireFeature('bookingsDocs')) — see bookingsAdmin.routes.js.
router.use('/admin/fd-packages', fdPackagesAdminRoutes);
router.use('/admin/relationship-managers', relationshipManagersRoutes);
router.use('/admin/sales-managers', salesManagersRoutes);
// Order matters here: the more specific /custom-role path must be
// registered before the generic /admin/employees router below, so a
// request there is never shadowed by the generic router's own `/:id`
// pattern (which would otherwise try to treat "custom-role" as a user id).
router.use('/admin/employees/custom-role', customRoleEmployeesRoutes);
router.use('/admin/employees', employeesRoutes);
router.use('/admin/marketing', marketingRoutes);
router.use('/admin/operations', fdOperationsAdminRoutes);
router.use('/admin/bookings', bookingsAdminRoutes);
router.use('/admin/package-requests', packageRequestsAdminRoutes);
router.use('/admin/mice-rfqs', miceRfqsAdminRoutes);
// Admin "Terms & Conditions" tab — its own RBAC gate (requireFeature('catalog'),
// same key Product/MICE Catalog use) but still registered here, ahead of the
// bare-/admin trio, per the same convention as every other specific-prefix
// router above (defensive — 'catalog' already passes adminCatalogRouter's
// own identical gate today, but this keeps the ordering consistent).
router.use('/admin/site-terms', adminSiteTermsRouter);
// Admin console "Security" screen — the global authenticator-app (2FA)
// toggle. GET is open to any staff role (renders the page's current state),
// the mutations are super_admin-only (adminSecurity.routes.js). Registered
// ahead of the bare-/admin trio, same specific-prefix-first convention as
// every router above.
router.use('/admin/security', adminSecurityRoutes);
router.use('/admin', adminRoutes);
router.use('/admin', adminCatalogRouter);
router.use('/admin', adminPaymentsRouter);
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
router.use('/', siteTermsRoutes);
router.use('/departures', departuresRoutes);
router.use('/package-requests', packageRequestsRoutes);
// /admin/package-requests and /admin/mice-rfqs themselves are registered
// earlier, alongside the other specific-prefix /admin/* routers (see the
// comment up there) — moved up from here to fix the same shadowing bug.
// pdfToken-authenticated (not requireAuth) — see itineraryPdfData.routes.js.
router.use('/itinerary-pdf', itineraryPdfDataRoutes);
// Same, for FD departure itineraries — see fdItineraryPdfData.routes.js.
router.use('/fd-itinerary-pdf', fdItineraryPdfDataRoutes);
router.use('/mice/rfqs', miceRfqsRoutes);
router.use('/payments', paymentsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/reviews', reviewsRoutes);
router.use('/departure-locations', locationsRoutes);
router.use('/notifications', notificationsRoutes);

export default router;
