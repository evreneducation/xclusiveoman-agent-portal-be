import { Router } from 'express';
import * as cmsController from '../controllers/cms.controller.js';

// Public CMS Page Viewer (Task 21 — Item 34 continuation). Deliberately no
// requireAuth/requireRole here — mirrors marketingTracking.routes.js's own
// "one documented public exception" pattern rather than weakening
// cms.routes.js's super_admin gate in any way. That file (mounted at
// /admin/cms) is completely untouched; this is a separate router mounted at
// /cms, so the two access levels (admin management vs. public view) can
// never share a code path by accident.
const router = Router();

router.get('/pages/:slug', cmsController.getPublishedPage);

export default router;
