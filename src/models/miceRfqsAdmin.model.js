import { pool } from '../db/pool.js';
import { replaceItinerary } from './miceRfqs.model.js';

// Admin-side queries only (listing with joins/pagination/search, lead-manager
// assignment) — mirrors packageRequestsAdmin.model.js. Detail sub-lists
// (hotels/tours/transfers/activities) are reused as-is from
// models/miceRfqs.model.js by the controller, not duplicated here.

const JOINS = `
  FROM mice_rfqs mr
  JOIN agencies a ON a.id = mr.agency_id
  JOIN users u ON u.id = mr.created_by_user_id
  LEFT JOIN users lm ON lm.id = mr.lead_manager_user_id
  LEFT JOIN users pub ON pub.id = mr.published_by_user_id
`;

const SELECT_COLUMNS = `
  mr.*,
  a.name AS agency_name,
  u.full_name AS agent_full_name,
  u.email AS agent_email,
  lm.full_name AS lead_manager_full_name,
  lm.email AS lead_manager_email,
  pub.full_name AS published_by_full_name
`;

function buildFilters({ status, search, eventFrom, eventTo }) {
  const clauses = [];
  const values = [];
  let i = 1;

  if (status) {
    clauses.push(`mr.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (eventFrom) {
    clauses.push(`mr.event_date_from >= $${i}`);
    values.push(eventFrom);
    i += 1;
  }
  if (eventTo) {
    clauses.push(`mr.event_date_from < ($${i}::date + interval '1 day')`);
    values.push(eventTo);
    i += 1;
  }
  if (search) {
    clauses.push(`(mr.id::text ILIKE $${i} OR u.full_name ILIKE $${i} OR a.name ILIKE $${i} OR mr.destination ILIKE $${i})`);
    values.push(`%${search}%`);
    i += 1;
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values, next: i };
}

export async function listMiceRfqsForAdmin({ status, search, eventFrom, eventTo, page, pageSize } = {}) {
  const { where, values, next } = buildFilters({ status, search, eventFrom, eventTo });

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) ${JOINS} ${where}`, values);
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} ${where}
     ORDER BY mr.created_at DESC
     LIMIT $${next} OFFSET $${next + 1}`,
    [...values, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

export async function findMiceRfqForAdmin(id) {
  const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} ${JOINS} WHERE mr.id = $1`, [id]);
  return rows[0] || null;
}

export async function updateMiceRfqLeadManager(id, leadManagerUserId) {
  const { rows } = await pool.query(
    `UPDATE mice_rfqs SET lead_manager_user_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [leadManagerUserId, id]
  );
  return rows[0] || null;
}

// MICE Costing & Markup Panel ("Save Draft"). net_cost_total is the doc's
// own column for the aggregate Landing Cost (mirrors package_requests'
// net_cost_breakdown.landingCost) — cost_breakdown holds only the five
// per-component auto/override/total figures, not a duplicate of the total.
export async function updateMiceRfqCosting(id, { costBreakdown, landingCost, markupRule, sellPrice, internalNotes, status }) {
  const { rows } = await pool.query(
    `UPDATE mice_rfqs
     SET cost_breakdown = $1, net_cost_total = $2, markup_rule = $3, sell_price = $4, internal_notes = $5,
         status = $6, updated_at = now()
     WHERE id = $7
     RETURNING *`,
    [JSON.stringify(costBreakdown), landingCost, JSON.stringify(markupRule), sellPrice, internalNotes, status, id]
  );
  return rows[0] || null;
}

// Day-wise Itinerary Planner — admin edit. Reuses the exact same
// replaceItinerary the agent builder writes through (miceRfqs.model.js) —
// "the finalized version should be shown back to the agent exactly as
// arranged" just falls out of both sides reading/writing the same rows, no
// separate admin copy. Mirrors packageRequestsAdmin.model.js's
// updatePackageRequestItinerary.
export async function updateMiceRfqItinerary(id, days) {
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
}

// "Publish Proposal". Costing/markup are saved separately
// (updateMiceRfqCosting, above) before this is ever called — this only
// flips status and stamps who/when, same split as package_requests.
export async function publishMiceRfq(id, publishedByUserId) {
  const { rows } = await pool.query(
    `UPDATE mice_rfqs
     SET status = 'published', published_at = now(), published_by_user_id = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [publishedByUserId, id]
  );
  return rows[0] || null;
}
