import { pool } from '../db/pool.js';

// Admin Support & Helpdesk (Task 18 — Screen 27/28, SUP-1..3). Agent-side
// (own-agency) and admin-side (all agencies, joined) queries live together
// here, same file-organization choice as bookings.model.js/bookingsAdmin.model.js
// before it — one schema, two access patterns.

const ADMIN_JOINS = `
  FROM support_tickets t
  JOIN agencies a ON a.id = t.agency_id
  JOIN users creator ON creator.id = t.created_by_user_id
  LEFT JOIN users assignee ON assignee.id = t.assigned_to_user_id
`;

const ADMIN_SELECT_COLUMNS = `
  t.*,
  a.name AS agency_name,
  creator.full_name AS created_by_name,
  creator.email AS created_by_email,
  assignee.full_name AS assigned_to_name
`;

// --- Agent-side (own agency only) ---

export async function createTicket({ agencyId, createdByUserId, subject, description, priority }) {
  const { rows } = await pool.query(
    `INSERT INTO support_tickets (agency_id, created_by_user_id, subject, description, priority)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'normal')::support_ticket_priority)
     RETURNING *`,
    [agencyId, createdByUserId, subject, description, priority || null]
  );
  return rows[0];
}

// GET /support/tickets — an agency's own ticket count is small (same scale
// as "My Bookings", which also has no pagination), so this returns every
// ticket for the agency, newest first — no separate detail endpoint exists
// for the agent (matches the doc's own literal route table, which lists no
// agent ticket-detail GET); the frontend finds one ticket's thread from
// this same response instead of a second fetch.
export async function listTicketsForAgency(agencyId) {
  const { rows } = await pool.query(
    'SELECT * FROM support_tickets WHERE agency_id = $1 ORDER BY created_at DESC',
    [agencyId]
  );
  return rows;
}

// Ownership-scoped fetch — every agent-side write (reply) re-verifies this
// rather than trusting a bare ticket_id, same posture as
// payments.controller.js#assertOwnsBooking.
export async function findTicketForAgency(ticketId, agencyId) {
  const { rows } = await pool.query('SELECT * FROM support_tickets WHERE id = $1 AND agency_id = $2', [ticketId, agencyId]);
  return rows[0] || null;
}

// --- Admin-side (all agencies) ---

// `agencyIds` — Team Portal Support Tickets scoping (a Relationship
// Manager only ever sees tickets raised by their own assigned agencies),
// mirrors every other admin list's identical param (bookingsAdmin.model.js,
// packageRequestsAdmin.model.js, …) — server-set, never client-suppliable.
function buildAdminFilters({ status, priority, assignedToUserId, agencyIds, search }) {
  const clauses = [];
  const values = [];
  let i = 1;

  if (status) {
    clauses.push(`t.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (priority) {
    clauses.push(`t.priority = $${i}`);
    values.push(priority);
    i += 1;
  }
  if (assignedToUserId) {
    clauses.push(`t.assigned_to_user_id = $${i}`);
    values.push(assignedToUserId);
    i += 1;
  }
  if (agencyIds) {
    clauses.push(`t.agency_id = ANY($${i}::uuid[])`);
    values.push(agencyIds);
    i += 1;
  }
  if (search) {
    clauses.push(`(t.subject ILIKE $${i} OR a.name ILIKE $${i} OR creator.full_name ILIKE $${i})`);
    values.push(`%${search}%`);
    i += 1;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, values, next: i };
}

// GET /admin/support/tickets — same LIMIT/OFFSET + {rows,total,page,pageSize}
// shape as every other admin list in this codebase (packageRequestsAdmin,
// bookingsAdmin, …).
export async function listTicketsForAdmin({ status, priority, assignedToUserId, agencyIds, search, page, pageSize } = {}) {
  const { where, values, next } = buildAdminFilters({ status, priority, assignedToUserId, agencyIds, search });

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) ${ADMIN_JOINS} ${where}`, values);
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT ${ADMIN_SELECT_COLUMNS} ${ADMIN_JOINS} ${where}
     ORDER BY t.created_at DESC
     LIMIT $${next} OFFSET $${next + 1}`,
    [...values, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

export async function findTicketForAdmin(ticketId) {
  const { rows } = await pool.query(`SELECT ${ADMIN_SELECT_COLUMNS} ${ADMIN_JOINS} WHERE t.id = $1`, [ticketId]);
  return rows[0] || null;
}

// PATCH /admin/support/tickets/:id — assign and/or change status (doc's own
// route purpose: "Assign, change status"). Both are optional/independent —
// COALESCE keeps whichever field wasn't provided unchanged. Priority is
// never editable here (Task 18 scope: set once at creation, admin only
// filters by it).
export async function updateTicketAssignmentAndStatus(ticketId, { assignedToUserId, status }) {
  const { rows } = await pool.query(
    `UPDATE support_tickets
     SET assigned_to_user_id = CASE WHEN $2::boolean THEN $3::uuid ELSE assigned_to_user_id END,
         status = COALESCE($4::support_ticket_status, status),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [ticketId, assignedToUserId !== undefined, assignedToUserId || null, status || null]
  );
  return rows[0] || null;
}

// --- Messages (shared by both sides) ---

export async function insertTicketMessage({ ticketId, senderUserId, message }) {
  const { rows } = await pool.query(
    `INSERT INTO ticket_messages (ticket_id, sender_user_id, message) VALUES ($1, $2, $3) RETURNING *`,
    [ticketId, senderUserId, message]
  );
  // Threaded replies don't change status (Task 18 scope decision) but do
  // count as activity — bump updated_at so admin queue "most recently
  // active" ordering (if ever added) and the ticket's own updated_at stay
  // meaningful without needing a second write path.
  await pool.query('UPDATE support_tickets SET updated_at = now() WHERE id = $1', [ticketId]);
  return rows[0];
}

// Joined with sender identity — used by both the agent's embedded-in-list
// thread view and the admin detail view, so the two can never render a
// message thread differently.
export async function listMessagesForTicket(ticketId) {
  const { rows } = await pool.query(
    `SELECT tm.*, u.full_name AS sender_name, u.role AS sender_role
     FROM ticket_messages tm
     JOIN users u ON u.id = tm.sender_user_id
     WHERE tm.ticket_id = $1
     ORDER BY tm.created_at ASC`,
    [ticketId]
  );
  return rows;
}
