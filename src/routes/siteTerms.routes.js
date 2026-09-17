const {
  Router
} = require('express');

const {
  requireAuth,
  requireRole,
  requireFeature,
  STAFF_ROLES
} = require('../middleware/auth.js');

const {
  validateBody,
  siteTermsSchema
} = require('../validation/schemas.js');

const {
  getSiteTerms,
  updateSiteTerms
} = require('../controllers/siteTerms.controller.js');

const router = Router();

// Admin "Terms & Conditions" tab (new top-level sidebar item,
// TermsAndConditions.jsx) — a single admin-authored rich-text document
// (site_terms, 0067_site_terms.sql). Read is open to any authenticated user
// (agent or staff), same "public-to-agents" posture catalog.routes.js's own
// GETs already have, in case this is ever surfaced outside the admin editor
// itself; only staff with Catalog Access can edit it (adminSiteTermsRouter
// below).
router.get('/site-terms', requireAuth, getSiteTerms);

const adminSiteTermsRouter = Router();
adminSiteTermsRouter.use(requireAuth, requireRole(...STAFF_ROLES), requireFeature('catalog'));
adminSiteTermsRouter.patch('/', validateBody(siteTermsSchema), updateSiteTerms);

module.exports = router;
module.exports.adminSiteTermsRouter = adminSiteTermsRouter;
