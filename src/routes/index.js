import { Router } from 'express';
import authRoutes from './auth.routes.js';
import agenciesRoutes from './agencies.routes.js';
import adminRoutes from './admin.routes.js';
import catalogRoutes, { adminCatalogRouter } from './catalog.routes.js';
import departuresRoutes from './departures.routes.js';
import fdPackagesAdminRoutes from './fdPackagesAdmin.routes.js';
import paymentsRoutes, { adminPaymentsRouter } from './payments.routes.js';
import bookingsRoutes from './bookings.routes.js';
import relationshipManagersRoutes from './relationshipManagers.routes.js';

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.use('/auth', authRoutes);
router.use('/agencies', agenciesRoutes);
router.use('/admin', adminRoutes);
router.use('/admin', adminCatalogRouter);
router.use('/admin', adminPaymentsRouter);
router.use('/admin/fd-packages', fdPackagesAdminRoutes);
router.use('/admin/relationship-managers', relationshipManagersRoutes);
router.use('/', catalogRoutes);
router.use('/departures', departuresRoutes);
router.use('/payments', paymentsRoutes);
router.use('/bookings', bookingsRoutes);

export default router;
