import { Router } from 'express';
import * as reviewsAdminController from '../controllers/reviewsAdmin.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, updateReviewStatusSchema } from '../validation/schemas.js';

// Admin Reviews Management (Task 21 — Item 33, Screen 33). ops_admin/
// super_admin only — deliberately narrower than STAFF_ROLES (unlike
// Product/MICE Catalog's broader gate), per this task's explicit RBAC
// scope: moderation isn't automatically a finance/support/marketing/
// relationship-manager/sales-manager concern. Same requireRole(...) call
// shape as fdOperationsAdmin.routes.js/bookingsAdmin.routes.js.
const router = Router();
router.use(requireAuth, requireRole('ops_admin', 'super_admin'));

router.get('/', reviewsAdminController.listReviews);
router.patch('/:id', validateBody(updateReviewStatusSchema), reviewsAdminController.updateReviewStatus);

export default router;
