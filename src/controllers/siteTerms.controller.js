import { siteTermsModel } from '../models/siteTerms.model.js';

// GET /site-terms — any authenticated user (agent or staff), same
// "public-to-agents" read posture catalog.routes.js's own entity GETs
// already have. `terms` is null until an admin has saved it at least once.
export async function getSiteTerms(req, res, next) {
  try {
    const row = await siteTermsModel.get();
    res.json({ terms: row });
  } catch (err) {
    next(err);
  }
}

// PATCH /admin/site-terms — staff with Catalog Access only (see
// siteTerms.routes.js). Upserts in one call so the admin editor
// (TermsAndConditions.jsx) never has to know whether a row already exists.
export async function updateSiteTerms(req, res, next) {
  try {
    const row = await siteTermsModel.upsert(req.body.bodyHtml);
    res.json({ terms: row });
  } catch (err) {
    next(err);
  }
}
