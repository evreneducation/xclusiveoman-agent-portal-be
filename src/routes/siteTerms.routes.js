import { Router } from 'express';
import { requireAuth, requireRole, requireFeature, STAFF_ROLES } from '../middleware/auth.js';
import { validateBody, siteTermsSchema } from '../validation/schemas.js';
import { getSiteTerms, updateSiteTerms } from '../controllers/siteTerms.controller.js';

const router = Router();

// Admin "Terms & Conditions" tab (new top-level sidebar item,
// TermsAndConditions.jsx) — a single admin-authored rich-text document
// (site_terms, 0067_site_terms.sql). Read is open to any authenticated user
// (agent or staff), same "public-to-agents" posture catalog.routes.js's own
// GETs already have, in case this is ever surfaced outside the admin editor
// itself; only staff with Catalog Access can edit it (adminSiteTermsRouter
// below).
router.get('/site-terms', requireAuth, getSiteTerms);

// requireFeature('catalog') — same Access Feature key Product/MICE Catalog
// already gate on (Content Catalog is this tab's nearest sibling in the
// sidebar); only narrows sales_manager/relationship_manager, every other
// staff role passes straight through same as elsewhere.
//
// Mounted at the full '/admin/site-terms' prefix in routes/index.js (same
// "prefix carries the full path, routes here are relative to it" convention
// fdOperationsAdmin.routes.js etc. use) — so the one PATCH this router
// handles is registered at '/', not '/site-terms' again.
export const adminSiteTermsRouter = Router();
adminSiteTermsRouter.use(requireAuth, requireRole(...STAFF_ROLES), requireFeature('catalog'));
adminSiteTermsRouter.patch('/', validateBody(siteTermsSchema), updateSiteTerms);

export default router;
