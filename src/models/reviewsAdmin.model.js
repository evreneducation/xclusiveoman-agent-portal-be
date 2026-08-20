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
  let i = 1;

  if (status) {
    clauses.push(`r.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (rating) {
    clauses.push(`r.rating = $${i}`);
    values.push(Number(rating));
    i += 1;
  }
  if (search) {
    // Agency name / package name / review text — the three fields the task
    // explicitly named as useful for moderation. Not searching booking id or
    // any unrelated table.
    clauses.push(`(a.name ILIKE $${i} OR fp.title ILIKE $${i} OR r.review_text ILIKE $${i})`);
    values.push(`%${search}%`);
    i += 1;
  }

  const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
  return { where, values, next: i };
}

// GET /admin/reviews — same LIMIT/OFFSET + {rows,total,page,pageSize} shape
// as listBookingsForAdmin/listPackageRequestsForAdmin.
export async function listReviewsForAdmin({ status, rating, search, page, pageSize } = {}) {
  const { where, values, next } = buildFilters({ status, rating, search });

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) ${JOINS} ${where}`, values);
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} ${where}
     ORDER BY r.submitted_at DESC
     LIMIT $${next} OFFSET $${next + 1}`,
    [...values, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

export async function findReviewByIdForAdmin(id) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} AND r.id = $1`,
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
    `SELECT COUNT(*) AS review_count, ROUND(AVG(rating)::numeric, 2) AS avg_rating
     FROM reviews WHERE fd_package_id = $1 AND status = 'published'`,
    [fdPackageId]
  );
  const { review_count: reviewCount, avg_rating: avgRating } = rows[0];
  // Both COALESCE(...) targets need an explicit cast — without one, Postgres
  // infers $1/$2's type from the untyped `0` literal shared by both
  // COALESCE calls in this one statement rather than from each target
  // column independently, which collapses avgRating (numeric, e.g. "5.00")
  // into an integer parse attempt and throws "invalid input syntax for type
  // integer". Same class of enum/type-inference gotcha this codebase has
  // hit before (see cms.model.js#createCmsPage's own comment) — just
  // NUMERIC/INTEGER here instead of an enum.
  await client.query(
    `UPDATE fd_packages SET rating = COALESCE($1::numeric, 0), review_count = COALESCE($2::integer, 0), updated_at = now() WHERE id = $3`,
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

    const { rows: existingRows } = await client.query('SELECT * FROM reviews WHERE id = $1 FOR UPDATE', [id]);
    const existing = existingRows[0];
    if (!existing) {
      await client.query('ROLLBACK');
      return null;
    }

    if (existing.status === status) {
      await client.query('ROLLBACK');
      return { review: existing, changed: false };
    }

    const { rows: updatedRows } = await client.query(
      'UPDATE reviews SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
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
