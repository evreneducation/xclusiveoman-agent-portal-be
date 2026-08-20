import { pool } from '../db/pool.js';

// Admin Content & CMS Management (Task 21 — Item 34). Deliberately NOT built
// on catalog.model.js's createCrudModel() — that factory's list() only knows
// how to filter by city/search/isMiceEnabled/mealType (hardcoded to those
// exact names for the Product/MICE Catalog entities), and cms_pages needs to
// filter by `section` (Screen 34's four tabs) and `status`, which the
// factory has no concept of. Written as its own small model instead, in the
// same shape (list/findById/create/update/remove) and same
// parameterized-query style, rather than bending the factory to fit.

// Screen 34's four tabs read the same cms_pages table, distinguished only by
// the free-text `section` column (no DB enum — see 0058_cms.sql's own
// comment). `section` here accepts either one value or an array of values
// (a tab can group more than one section label — see admin/pages
// ContentManagement.jsx's own comment on why, grounded in the wireframe's
// own example rows using different section labels for what is clearly the
// same "Oman Overview Pages" tab).
export async function listCmsPages({ section, status, search } = {}) {
  const clauses = [];
  const values = [];
  let i = 1;

  if (section) {
    const sections = Array.isArray(section) ? section : [section];
    clauses.push(`section = ANY($${i}::text[])`);
    values.push(sections);
    i += 1;
  }
  if (status) {
    clauses.push(`status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (search) {
    clauses.push(`(title ILIKE $${i} OR slug ILIKE $${i})`);
    values.push(`%${search}%`);
    i += 1;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM cms_pages ${where} ORDER BY updated_at DESC`, values);
  return rows;
}

export async function findCmsPageById(id) {
  const { rows } = await pool.query('SELECT * FROM cms_pages WHERE id = $1', [id]);
  return rows[0] || null;
}

// Public CMS Page Viewer (Task 21 — Item 34 continuation). The `status =
// 'published'` condition lives in the query itself, not as an
// after-the-fact filter in the controller — a slug that resolves to a draft
// row must come back exactly like a slug that doesn't exist at all (both
// null here, both 404 at the controller), so a public caller can never
// distinguish "no such page" from "this page exists but isn't published
// yet".
export async function findPublishedBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT * FROM cms_pages WHERE slug = $1 AND status = 'published' LIMIT 1`,
    [slug]
  );
  return rows[0] || null;
}

export async function createCmsPage({ title, section, slug, bodyHtml, status }) {
  // COALESCE($5, 'draft') without a cast leaves $5 typed as plain `text`,
  // which Postgres then refuses to assign into the `status cms_page_status`
  // column ("column is of type cms_page_status but expression is of type
  // text") — same enum-cast gotcha this codebase has hit before wherever a
  // COALESCE mixes a bound parameter with an enum column (see e.g. Task 18's
  // discovered pattern). Casting the whole COALESCE result fixes it.
  const { rows } = await pool.query(
    `INSERT INTO cms_pages (title, section, slug, body_html, status)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'draft')::cms_page_status)
     RETURNING *`,
    [title, section, slug, bodyHtml ?? null, status]
  );
  return rows[0];
}

export async function updateCmsPage(id, fields) {
  const columns = { title: 'title', section: 'section', slug: 'slug', bodyHtml: 'body_html', status: 'status' };
  const cols = Object.keys(columns).filter((k) => fields[k] !== undefined);
  if (cols.length === 0) return findCmsPageById(id);

  const setClauses = cols.map((k, idx) => `${columns[k]} = $${idx + 1}`);
  const values = cols.map((k) => fields[k]);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE cms_pages SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] || null;
}

export async function removeCmsPage(id) {
  await pool.query('DELETE FROM cms_pages WHERE id = $1', [id]);
}

// Media Library (CMS-3) — GET/POST only, per this task's documented scope
// (no PATCH/DELETE requested).
export async function listMedia() {
  const { rows } = await pool.query('SELECT * FROM media_library ORDER BY created_at DESC');
  return rows;
}

export async function createMedia({ url, altText, uploadedByUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO media_library (url, alt_text, uploaded_by_user_id) VALUES ($1, $2, $3) RETURNING *`,
    [url, altText ?? null, uploadedByUserId]
  );
  return rows[0];
}
