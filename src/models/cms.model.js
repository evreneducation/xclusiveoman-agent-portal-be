const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function listCmsPages({ section, status, search } = {}) {
  const clauses = [];
  const values = [];

  if (section) {
    const sections = Array.isArray(section) ? section : [section];
    clauses.push(`section IN (?)`);
    values.push(sections);
  }
  if (status) {
    clauses.push(`status = ?`);
    values.push(status);
  }
  if (search) {
    clauses.push(`(LOWER(title) LIKE LOWER(?) OR LOWER(slug) LIKE LOWER(?))`);
    values.push(`%${search}%`, `%${search}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM cms_pages ${where} ORDER BY updated_at DESC`, values);
  return rows;
}

module.exports.listCmsPages = listCmsPages;

async function findCmsPageById(id) {
  const { rows } = await pool.query('SELECT * FROM cms_pages WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.findCmsPageById = findCmsPageById;

async function findPublishedBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT * FROM cms_pages WHERE slug = ? AND status = 'published' LIMIT 1`,
    [slug]
  );
  return rows[0] || null;
}

module.exports.findPublishedBySlug = findPublishedBySlug;

async function createCmsPage({ title, section, slug, bodyHtml, status }) {
  // Postgres needed an explicit `::cms_page_status` cast on this COALESCE
  // (COALESCE($5, 'draft') alone comes back typed as plain `text`, which
  // Postgres then refuses to assign into the enum-typed `status` column).
  // MySQL has no such enum-cast gotcha — COALESCE(?, 'draft') assigns into
  // the column directly.
  const id = newId();
  await pool.query(
    `INSERT INTO cms_pages (id, title, section, slug, body_html, status)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, 'draft'))`,
    [id, title, section, slug, bodyHtml ?? null, status]
  );
  const { rows } = await pool.query('SELECT * FROM cms_pages WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createCmsPage = createCmsPage;

async function updateCmsPage(id, fields) {
  const columns = { title: 'title', section: 'section', slug: 'slug', bodyHtml: 'body_html', status: 'status' };
  const cols = Object.keys(columns).filter((k) => fields[k] !== undefined);
  if (cols.length === 0) return findCmsPageById(id);

  const setClauses = cols.map((k) => `${columns[k]} = ?`);
  const values = cols.map((k) => fields[k]);
  values.push(id);

  await pool.query(
    `UPDATE cms_pages SET ${setClauses.join(', ')}, updated_at = now() WHERE id = ?`,
    values
  );
  const { rows } = await pool.query('SELECT * FROM cms_pages WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.updateCmsPage = updateCmsPage;

async function removeCmsPage(id) {
  await pool.query('DELETE FROM cms_pages WHERE id = ?', [id]);
}

module.exports.removeCmsPage = removeCmsPage;

async function listMedia() {
  const { rows } = await pool.query('SELECT * FROM media_library ORDER BY created_at DESC');
  return rows;
}

module.exports.listMedia = listMedia;

async function createMedia({ url, altText, uploadedByUserId }) {
  const id = newId();
  await pool.query(
    `INSERT INTO media_library (id, url, alt_text, uploaded_by_user_id) VALUES (?, ?, ?, ?)`,
    [id, url, altText ?? null, uploadedByUserId]
  );
  const { rows } = await pool.query('SELECT * FROM media_library WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createMedia = createMedia;
