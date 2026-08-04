import { pool } from '../db/pool.js';

// Admin-side queries only (listing with joins/pagination/search, lead-manager
// assignment). Detail sub-lists (hotels/tours/transfers/activities/travelers)
// are reused as-is from models/packageRequests.model.js by the controller —
// not duplicated here.

const JOINS = `
  FROM package_requests pr
  JOIN agencies a ON a.id = pr.agency_id
  JOIN users u ON u.id = pr.created_by_user_id
  LEFT JOIN users lm ON lm.id = pr.lead_manager_user_id
`;

const SELECT_COLUMNS = `
  pr.*,
  a.name AS agency_name,
  u.full_name AS agent_full_name,
  u.email AS agent_email,
  lm.full_name AS lead_manager_full_name,
  lm.email AS lead_manager_email
`;

// Item 1: the inbox only ever shows requests the agent has actually
// submitted — draft rows (unused by the current agent flow, which always
// submits directly, but kept in the schema for fidelity) are excluded.
function buildFilters({ status, destination, search, submittedFrom, submittedTo }) {
  const clauses = [`pr.status <> 'draft'`];
  const values = [];
  let i = 1;

  if (status) {
    clauses.push(`pr.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (destination) {
    clauses.push(`pr.destination ILIKE $${i}`);
    values.push(`%${destination}%`);
    i += 1;
  }
  if (submittedFrom) {
    clauses.push(`pr.created_at >= $${i}`);
    values.push(submittedFrom);
    i += 1;
  }
  if (submittedTo) {
    clauses.push(`pr.created_at < ($${i}::date + interval '1 day')`);
    values.push(submittedTo);
    i += 1;
  }
  if (search) {
    clauses.push(`(pr.id::text ILIKE $${i} OR u.full_name ILIKE $${i} OR a.name ILIKE $${i} OR pr.destination ILIKE $${i})`);
    values.push(`%${search}%`);
    i += 1;
  }

  return { where: `WHERE ${clauses.join(' AND ')}`, values, next: i };
}

export async function listPackageRequestsForAdmin({
  status, destination, search, submittedFrom, submittedTo, page, pageSize,
} = {}) {
  const { where, values, next } = buildFilters({ status, destination, search, submittedFrom, submittedTo });

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) ${JOINS} ${where}`,
    values
  );
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} ${where}
     ORDER BY pr.created_at DESC
     LIMIT $${next} OFFSET $${next + 1}`,
    [...values, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

export async function findPackageRequestForAdmin(id) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} WHERE pr.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function updatePackageRequestLeadManager(id, leadManagerUserId, status) {
  const { rows } = await pool.query(
    `UPDATE package_requests
     SET lead_manager_user_id = $1, status = $2, updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [leadManagerUserId, status, id]
  );
  return rows[0] || null;
}
