import { Router } from 'express';
import * as fdOperationsController from '../controllers/fdOperationsAdmin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  validateBody,
  advanceFdOperationsStageSchema,
  fdOperationsSupplierLogSchema,
  fdOperationsDriverDetailsSchema,
  fdOperationsTourUpdateSchema,
} from '../validation/schemas.js';

const router = Router();

// Admin FD Operations Tracker (Task 12 — Screen 19). Its own RBAC gate,
// independent of Marketing Center's (marketing.routes.js) — per the task's
// own instruction, ops_admin/super_admin only, and this must never be
// weakened to also satisfy Marketing's sales_marketing role or vice versa.
router.use(requireAuth, requireRole('ops_admin', 'super_admin'));

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
