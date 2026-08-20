import { Router } from 'express';
import * as cmsController from '../controllers/cms.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { validateBody, cmsPageSchema } from '../validation/schemas.js';

// Admin Content & CMS Management (Task 21 — Item 34, Screen 34). Every route
// here is super_admin-only — an explicit override of the doc's own §12.11
// role column (illegible for these two rows in the extracted table, but
// read contextually as ops_admin+ like its neighboring Analytics/Operations
// rows) per this task's own explicit instruction. requireRole('super_admin')
// is the same middleware every other admin router already uses
// (bookingsAdmin.routes.js, fdOperationsAdmin.routes.js, …) — just called
// with a single, narrower role list instead of STAFF_ROLES.
const router = Router();
router.use(requireAuth, requireRole('super_admin'));

router.get('/pages', cmsController.listPages);
router.post('/pages', validateBody(cmsPageSchema), cmsController.createPage);
router.get('/pages/:id', cmsController.getPage);
router.patch('/pages/:id', validateBody(cmsPageSchema.partial()), cmsController.updatePage);
router.delete('/pages/:id', cmsController.deletePage);

router.get('/media', cmsController.listMediaAssets);
router.post('/media', upload.single('file'), cmsController.uploadMedia);

export default router;
