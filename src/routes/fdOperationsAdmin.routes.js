import { Router } from 'express';
import * as fdOperationsController from '../controllers/fdOperationsAdmin.controller.js';
import { requireAuth, requireRole, requireFeature } from '../middleware/auth.js';
import {
  validateBody,
  advanceFdOperationsStageSchema,
  fdOperationsSupplierLogSchema,
  fdOperationsDriverDetailsSchema,
  fdOperationsTourUpdateSchema,
} from '../validation/schemas.js';

const router = Router();

// Admin FD Operations Tracker (Task 12 — Screen 19). Its own RBAC gate,
// independent of Marketing Center's (marketing.routes.js) — originally
// ops_admin/super_admin only, deliberately never weakened to also satisfy
// Marketing's sales_marketing role. Widened once, since, to also admit
// sales_manager — the Team Portal's FD Operation Access Feature — gated for
// real by requireFeature('fdOperations') below, same "checkbox is the real
// gate for LM/RM, role alone isn't" pattern as bookingsAdmin.routes.js.
// relationship_manager deliberately stays excluded: FD Operation isn't one
// of RM_FEATURE_KEYS (config/accessFeatures.js) at all.
router.use(requireAuth, requireRole('ops_admin', 'super_admin', 'sales_manager'));
router.use(requireFeature('fdOperations'));

router.get('/departures', fdOperationsController.listDepartures);
router.get('/departures/:departureDateId', fdOperationsController.getDepartureDetail);
router.post(
  '/departures/:departureDateId/stage',
  validateBody(advanceFdOperationsStageSchema),
  fdOperationsController.advanceStage
);
router.post(
  '/departures/:departureDateId/supplier-log',
  validateBody(fdOperationsSupplierLogSchema),
  fdOperationsController.addSupplierLog
);
router.post(
  '/departures/:departureDateId/driver-details',
  validateBody(fdOperationsDriverDetailsSchema),
  fdOperationsController.dispatchDriver
);
router.post(
  '/departures/:departureDateId/tour-update',
  validateBody(fdOperationsTourUpdateSchema),
  fdOperationsController.publishTourUpdate
);

export default router;
