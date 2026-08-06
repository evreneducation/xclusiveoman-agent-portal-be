import { Router } from 'express';
import authRoutes from './auth.routes.js';
import agenciesRoutes from './agencies.routes.js';
import adminRoutes from './admin.routes.js';
import catalogRoutes, { adminCatalogRouter } from './catalog.routes.js';
import departuresRoutes from './departures.routes.js';
import packageRequestsRoutes from './packageRequests.routes.js';
import packageRequestsAdminRoutes from './packageRequestsAdmin.routes.js';
import miceRfqsRoutes from './miceRfqs.routes.js';
import miceRfqsAdminRoutes from './miceRfqsAdmin.routes.js';
import fdPackagesAdminRoutes from './fdPackagesAdmin.routes.js';
import paymentsRoutes, { adminPaymentsRouter } from './payments.routes.js';
import bookingsRoutes from './bookings.routes.js';
import relationshipManagersRoutes from './relationshipManagers.routes.js';
import salesManagersRoutes from './salesManagers.routes.js';
import locationsRoutes from './locations.routes.js';

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
router.use('/', catalogRoutes);
router.use('/departures', departuresRoutes);
router.use('/package-requests', packageRequestsRoutes);
router.use('/admin/package-requests', packageRequestsAdminRoutes);
router.use('/mice/rfqs', miceRfqsRoutes);
router.use('/admin/mice-rfqs', miceRfqsAdminRoutes);
router.use('/payments', paymentsRoutes);
router.use('/bookings', bookingsRoutes);
router.use('/departure-locations', locationsRoutes);

export default router;
