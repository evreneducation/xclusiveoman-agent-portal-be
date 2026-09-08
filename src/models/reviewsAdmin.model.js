import { pool } from '../db/pool.js';

// Admin Reviews Management (Task 21 — Item 33, Screen 33, REV-3/REV-4).
// Deliberately its own model rather than forced onto catalog.model.js's
// createCrudModel() — same reasoning Item 34's cms.model.js already
// documented: this needs status/rating/search filtering + pagination +ollup
// math the generic factory has no concept of. Reuses the exact
// {rows, total, page, pageSize} pagination shape and buildFilters/JOINS
// structure bookingsAdmin.model.js already established (Task 13), not a new
// pattern.

const JOINS = `
  FROM reviews r
  JOIN agencies a ON a.id = r.agency_id
  JOIN fd_packages fp ON fp.id = r.fd_package_id
  WHERE 1=1
`;

const SELECT_COLUMNS = `
  r.*,
  a.name AS agency_name,
  fp.title AS package_title
`;

function buildFilters({ status, rating, search }) {
  const clauses = [];
  const values = [];

  if (status) {
    clauses.push(`r.status = ?`);
    values.push(status);
  }
  if (rating) {
    clauses.push(`r.rating = ?`);
    values.push(Number(rating));
  }
  if (search) {
    // Agency name / package name / review text — the three fields the task
    // explicitly named as useful for moderation. Not searching booking id or
    // any unrelated table.
    clauses.push(`(LOWER(a.name) LIKE LOWER(?) OR LOWER(fp.title) LIKE LOWER(?) OR LOWER(r.review_text) LIKE LOWER(?))`);
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
  return { where, values };
}

// GET /admin/reviews — same LIMIT/OFFSET + {rows,total,page,pageSize} shape
// as listBookingsForAdmin/listPackageRequestsForAdmin.
export async function listReviewsForAdmin({ status, rating, search, page, pageSize } = {}) {
  const { where, values } = buildFilters({ status, rating, search });

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) AS count ${JOINS} ${where}`, values);
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} ${where}
     ORDER BY r.submitted_at DESC
     LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

export async function findReviewByIdForAdmin(id) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} AND r.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Recomputes fd_packages.rating/review_count from `published` reviews only
// (REV-4 — hidden/needs_review reviews must never affect the average) and
// writes both columns, all within the given transaction client. ROUND(...,
// 2) matches the task's own worked example (5,4,4 -> 4.33) — fd_packages.
// rating is a bare NUMERIC with no declared scale (checked via
// information_schema before writing this), so nothing at the column level
// forces rounding; this is an explicit, deliberate choice, not a DB
// constraint. COUNT/AVG naturally return 0/NULL over zero rows, which
// COALESCE turns into exactly the documented 0/0 case.
async function rollupPackageRating(client, fdPackageId) {
  const { rows } = await client.query(
    `SELECT COUNT(*) AS review_count, ROUND(AVG(rating), 2) AS avg_rating
     FROM reviews WHERE fd_package_id = ? AND status = 'published'`,
    [fdPackageId]
  );
  const { review_count: reviewCount, avg_rating: avgRating } = rows[0];
  // Postgres' explicit ::numeric/::integer casts on these two COALESCE(...)
  // targets dropped — that requirement was Postgres inferring a shared type
  // for $1/$2 from the untyped `0` literal shared by both COALESCE calls in
  // one statement (see cms.model.js#createCmsPage's own comment for the same
  // class of gotcha); MySQL has no such cross-parameter type inference, so
  // COALESCE(?, 0) just resolves against each target column's own type here.
  await client.query(
    `UPDATE fd_packages SET rating = COALESCE(?, 0), review_count = COALESCE(?, 0), updated_at = now() WHERE id = ?`,
    [avgRating, reviewCount, fdPackageId]
  );
}

// PATCH /admin/reviews/:id — the moderation action itself. Status update +
// rating rollup happen in one transaction (per this task's explicit
// requirement) so a package's rating can never end up computed against a
// review status that didn't actually commit. Returns:
//   - null                          if no review with this id exists (404)
//   - { review, changed: false }    if the requested status already matches
//                                    (idempotent no-op — no audit log, no
//                                    redundant rollup write; a full COUNT/AVG
//                                    recompute would be harmless either way,
//                                    but skipping it entirely is the more
//                                    literal reading of "avoid a meaningless
//                                    duplicate")
//   - { review, changed: true, previousStatus } otherwise, with the rollup
//     already applied — the caller (controller) does the audit log using
//     `previousStatus`/the new status, same as every other admin action in
//     this codebase logs outside its own DB transaction (e.g.
//     reviewsAgent.controller.js#submitReview already does insertAuditLog
//     after, not inside, its write).
export async function setReviewStatus(id, status) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query('SELECT * FROM reviews WHERE id = ? FOR UPDATE', [id]);
    const existing = existingRows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }

    if (existing.status === status) {
      await client.query('ROLLBACK');
      return { review: existing, changed: false };
    }

    await client.query('UPDATE reviews SET status = ? WHERE id = ?', [status, id]);
    const { rows: updatedRows } = await client.query('SELECT * FROM reviews WHERE id = ?', [id]);
    const updated = updatedRows[0];

    await rollupPackageRating(client, updated.fd_package_id);

    await client.query('COMMIT');
    return { review: updated, changed: true, previousStatus: existing.status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
