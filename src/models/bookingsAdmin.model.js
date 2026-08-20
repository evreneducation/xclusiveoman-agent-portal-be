import { pool } from '../db/pool.js';

// Admin Bookings & Documents (Task 13 — Screen 22, Manual Booking Flow).
// FD-only by construction, same scoping rule as fdOperations.model.js: this
// list is source_type='fd_package' only — package_request/mice_rfq bookings
// don't exist yet anywhere in this codebase (see Task 13's own audit), so
// this filter costs nothing today and stops a future FIT/MICE bookings row
// from silently appearing in an FD-shaped table before this page is taught
// how to render one. Shows both created_via values (self_service and
// manual_admin) — an admin managing bookings needs to see all of them, not
// just the ones they personally created.

const JOINS = `
  FROM bookings b
  JOIN agencies a ON a.id = b.agency_id
  JOIN fd_departure_dates fdd ON fdd.id = b.fd_departure_date_id
  JOIN fd_packages fp ON fp.id = fdd.fd_package_id
  JOIN users u ON u.id = b.created_by_user_id
  WHERE b.source_type = 'fd_package'
`;

const SELECT_COLUMNS = `
  b.*,
  a.name AS agency_name,
  fp.id AS fd_package_id,
  fp.title AS package_title,
  fdd.date AS departure_date,
  fdd.location AS departure_location,
  u.full_name AS created_by_name
`;

// `agencyIds` (plural, array) is the Team Portal's Relationship Manager
// scoping (bookingsAdmin.routes.js's own `scopeToOwnAgencyBooking` comment) —
// distinct from `agencyId` (singular), the existing admin UI's own
// single-agency filter dropdown. Both can be present; each is its own
// independent AND'd clause.
function buildFilters({ status, agencyId, agencyIds, search }) {
  const clauses = [];
  const values = [];
  let i = 1;

  if (status) {
    clauses.push(`b.status = $${i}`);
    values.push(status);
    i += 1;
  }
  if (agencyId) {
    clauses.push(`b.agency_id = $${i}`);
    values.push(agencyId);
    i += 1;
  }
  if (agencyIds) {
    clauses.push(`b.agency_id = ANY($${i}::uuid[])`);
    values.push(agencyIds);
    i += 1;
  }
  if (search) {
    clauses.push(`(a.name ILIKE $${i} OR fp.title ILIKE $${i})`);
    values.push(`%${search}%`);
    i += 1;
  }

  const where = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
  return { where, values, next: i };
}

// GET /admin/bookings — same LIMIT/OFFSET + {rows,total,page,pageSize} shape
// as listPackageRequestsForAdmin (packageRequestsAdmin.model.js).
export async function listBookingsForAdmin({ status, agencyId, agencyIds, search, page, pageSize } = {}) {
  const { where, values, next } = buildFilters({ status, agencyId, agencyIds, search });

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) ${JOINS} ${where}`, values);
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} ${JOINS} ${where}
     ORDER BY b.created_at DESC
     LIMIT $${next} OFFSET $${next + 1}`,
    [...values, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

// GET /admin/bookings/:id/documents (Task 14) and any other admin
// booking-detail screen — same JOIN shape as the list above, single row.
export async function findBookingDetailForAdmin(bookingId) {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     ${JOINS} AND b.id = $1`,
    [bookingId]
  );
  return rows[0] || null;
}
