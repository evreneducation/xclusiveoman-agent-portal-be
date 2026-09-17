const {
  listCmsPages,
  findCmsPageById,
  createCmsPage,
  updateCmsPage,
  removeCmsPage,
  listMedia,
  createMedia,
  findPublishedBySlug
} = require('../models/cms.model.js');

const {
  uploadBuffer
} = require('../services/cloudinary.service.js');

async function listPages(req, res, next) {
  try {
    const { status, search } = req.query;
    const section = req.query.section;
    const rows = await listCmsPages({ section, status, search });
    res.json({ pages: rows });
  } catch (err) {
    next(err);
  }
}

module.exports.listPages = listPages;

async function getPage(req, res, next) {
  try {
    const row = await findCmsPageById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ page: row });
  } catch (err) {
    next(err);
  }
}

module.exports.getPage = getPage;

async function createPage(req, res, next) {
  try {
    const row = await createCmsPage(req.body);
    res.status(201).json({ page: row });
  } catch (err) {
    next(err);
  }
}

module.exports.createPage = createPage;

async function updatePage(req, res, next) {
  try {
    const row = await updateCmsPage(req.params.id, req.body);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ page: row });
  } catch (err) {
    next(err);
  }
}

module.exports.updatePage = updatePage;

async function deletePage(req, res, next) {
  try {
    await removeCmsPage(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports.deletePage = deletePage;

async function getPublishedPage(req, res, next) {
  try {
    const row = await findPublishedBySlug(req.params.slug);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ page: row });
  } catch (err) {
    next(err);
  }
}

module.exports.getPublishedPage = getPublishedPage;

async function listMediaAssets(req, res, next) {
  try {
    const rows = await listMedia();
    res.json({ media: rows });
  } catch (err) {
    next(err);
  }
}

module.exports.listMediaAssets = listMediaAssets;

async function uploadMedia(req, res, next) {
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

module.exports.uploadMedia = uploadMedia;
