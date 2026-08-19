import {
  listCmsPages,
  findCmsPageById,
  createCmsPage,
  updateCmsPage,
  removeCmsPage,
  listMedia,
  createMedia,
  findPublishedBySlug,
} from '../models/cms.model.js';
import { uploadBuffer } from '../services/cloudinary.service.js';

// Admin Content & CMS Management (Task 21 — Item 34, Screen 34). Mounted at
// /admin/cms, gated super_admin-only end to end (see cms.routes.js) — this
// controller itself does no additional role work, the route-level
// requireRole('super_admin') is the single enforcement point, same pattern
// every other admin router in this codebase already uses.

// GET /admin/cms/pages?section=&status=&search= — section may be repeated
// (?section=a&section=b) to group more than one section label under one
// Screen 34 tab (see admin/pages/ContentManagement.jsx's own comment on why
// — the wireframe's own example rows use different section labels for what
// is clearly the same "Oman Overview Pages" tab).
export async function listPages(req, res, next) {
  try {
    const { status, search } = req.query;
    const section = req.query.section;
    const rows = await listCmsPages({ section, status, search });
    res.json({ pages: rows });
  } catch (err) {
    next(err);
  }
}

export async function getPage(req, res, next) {
  try {
    const row = await findCmsPageById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ page: row });
  } catch (err) {
    next(err);
  }
}

export async function createPage(req, res, next) {
  try {
    const row = await createCmsPage(req.body);
    res.status(201).json({ page: row });
  } catch (err) {
    next(err);
  }
}

export async function updatePage(req, res, next) {
  try {
    const row = await updateCmsPage(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ page: row });
  } catch (err) {
    next(err);
  }
}

export async function deletePage(req, res, next) {
  try {
    await removeCmsPage(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// GET /cms/pages/:slug — public CMS Page Viewer (Task 21 — Item 34
// continuation). Deliberately mounted on its own unauthenticated router
// (cmsPublic.routes.js), never on the super_admin-gated one above — same
// "public route lives in its own file, admin route stays untouched" split
// marketingTracking.routes.js already established for Marketing's own one
// public exception. findPublishedBySlug's own WHERE clause is the only
// thing standing between a draft page and public exposure; both "no such
// slug" and "slug exists but is still draft" resolve to the identical 404
// here, so neither response shape leaks which case it was.
export async function getPublishedPage(req, res, next) {
  try {
    const row = await findPublishedBySlug(req.params.slug);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ page: row });
  } catch (err) {
    next(err);
  }
}

// GET /admin/cms/media
export async function listMediaAssets(req, res, next) {
  try {
    const rows = await listMedia();
    res.json({ media: rows });
  } catch (err) {
    next(err);
  }
}

// POST /admin/cms/media — multipart, single file at req.file (field 'file'),
// optional `altText` body field. Mirrors uploadImagesHandlerFor's shape
// (catalog.controller.js) but creates a persisted media_library row instead
// of just returning a bare URL, since CMS media is meant to be browsable on
// its own (Screen 34's Media Library tab), not just attached to one entity.
export async function uploadMedia(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'Upload a file' });
    }
    const uploaded = await uploadBuffer(req.file.buffer, { folderParts: ['cms', 'media'] });
    const row = await createMedia({
      url: uploaded.secure_url,
      altText: req.body.altText,
      // req.user is the full row requireAuth attached (models/users.model.js
      // findUserById) — same field every other admin-actions-by-user write
      // in this codebase reads (e.g. reviewsAgent.controller.js's
      // req.user.id, insertAuditLog's actorUserId call sites).
      uploadedByUserId: req.user.id,
    });
    res.status(201).json({ media: row });
  } catch (err) {
    next(err);
  }
}
