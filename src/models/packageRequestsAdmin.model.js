import { pool } from '../db/pool.js';
import { replaceItinerary } from './packageRequests.model.js';

// Admin-side queries only (listing with joins/pagination/search, lead-manager
// assignment). Detail sub-lists (hotels/tours/transfers/activities/travelers)
// are reused as-is from models/packageRequests.model.js by the controller —
// not duplicated here.

const JOINS = `
  FROM package_requests pr
  JOIN agencies a ON a.id = pr.agency_id
  JOIN users u ON u.id = pr.created_by_user_id
  LEFT JOIN users lm ON lm.id = pr.lead_manager_user_id
  LEFT JOIN users pub ON pub.id = pr.published_by_user_id
`;

const SELECT_COLUMNS = `
  pr.*,
  a.name AS agency_name,
  u.full_name AS agent_full_name,
  u.email AS agent_email,
  lm.full_name AS lead_manager_full_name,
  lm.email AS lead_manager_email,
  pub.full_name AS published_by_full_name
`;

// Item 1: the inbox only ever shows requests the agent has actually
// submitted — draft rows (unused by the current agent flow, which always
// submits directly, but kept in the schema for fidelity) are excluded.
// `leadManagerUserId` (Team Portal's Quotes & Pricing page, LM scoping —
// packageRequestsAdmin.controller.js#list) and `agencyIds` (same page, RM
// scoping) are both server-set from the requesting user's own id/assigned
// agencies, never a client-suppliable filter — same posture as
// agencies.model.js#listAgencies' own agencyIds param.
function buildFilters({ status, destination, search, submittedFrom, submittedTo, leadManagerUserId, agencyIds }) {
  const clauses = [`pr.status <> 'draft'`];
  const values = [];
  let i = 1;

  if (status) {
    clauses.push(`pr.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (leadManagerUserId) {
    clauses.push(`pr.lead_manager_user_id = $${i}`);
    values.push(leadManagerUserId);
    i += 1;
  }
  if (agencyIds) {
    clauses.push(`pr.agency_id = ANY($${i}::uuid[])`);
    values.push(agencyIds);
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
  status, destination, search, submittedFrom, submittedTo, leadManagerUserId, agencyIds, page, pageSize,
} = {}) {
  const { where, values, next } = buildFilters({ status, destination, search, submittedFrom, submittedTo, leadManagerUserId, agencyIds });

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

// Quote Details — Editable Costing + Markup Panel ("Save Draft"). Always
// writes net_cost_breakdown/markup_rule/sell_price/internal_notes/inclusions/
// exclusions together since the FE always saves the full costing state in
// one call. inclusions/exclusions (0048_package_request_inclusions_exclusions.sql)
// are the client-facing counterpart to internal_notes — admin-authored free
// text shown read-only on the agent's own quote view once published
// (packageRequests.controller.js), unlike internal_notes which stays admin-only.
export async function updatePackageRequestCosting(id, { netCostBreakdown, markupRule, sellPrice, internalNotes, inclusions, exclusions, status }) {
  const { rows } = await pool.query(
    `UPDATE package_requests
     SET net_cost_breakdown = $1, markup_rule = $2, sell_price = $3, internal_notes = $4,
         inclusions = $5, exclusions = $6, status = $7, updated_at = now()
     WHERE id = $8
     RETURNING *`,
    [JSON.stringify(netCostBreakdown), JSON.stringify(markupRule), sellPrice, internalNotes, inclusions || '', exclusions || '', status, id]
  );
  return rows[0] || null;
}

// Quote Details — Day-wise Itinerary Planner (FIT-5). Admin edits reuse the
// same replaceItinerary the agent builder writes through — "the finalized
// version should be shown back to the agent exactly as approved" just falls
// out of both sides reading/writing the same rows, no separate admin copy.
export async function updatePackageRequestItinerary(id, days) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await replaceItinerary(client, id, days);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const { rows } = await pool.query(`SELECT id FROM package_requests WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Quote Details — "Publish Quote". Costing/markup are saved separately
// (updatePackageRequestCosting, above) before this is ever called — this
// only flips status and stamps who/when.
export async function publishPackageRequest(id, publishedByUserId) {
  const { rows } = await pool.query(
    `UPDATE package_requests
     SET status = 'published', published_at = now(), published_by_user_id = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [publishedByUserId, id]
  );
  return rows[0] || null;
}
