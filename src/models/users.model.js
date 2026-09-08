import { pool } from '../db/pool.js';
import { newId } from '../utils/id.js';

export async function createUser(
  client,
  { agencyId, role, fullName, email, phone, whatsappNumber, permissions }
) {
  const id = newId();
  await client.query(
    `INSERT INTO users (id, agency_id, role, full_name, email, phone, whatsapp_number, permissions)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, JSON_OBJECT()))`,
    [
      id,
      agencyId || null,
      role,
      fullName,
      email.toLowerCase(),
      phone || null,
      whatsappNumber || null,
      permissions ? JSON.stringify(permissions) : null,
    ]
  );
  const { rows } = await client.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0];
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = ?', [
    email.toLowerCase(),
  ]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function listStaff() {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id IS NULL ORDER BY created_at DESC`
  );
  return rows;
}

export async function listStaffByRole(role) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id IS NULL AND role = ? ORDER BY created_at DESC`,
    [role]
  );
  return rows;
}

export async function listAgencyUsers(agencyId) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id = ? ORDER BY created_at DESC`,
    [agencyId]
  );
  return rows;
}

// Marketing Center campaign sending (marketing.controller.js) — the
// recipient address for an agency is its owner's email, same source
// admin.controller.js::patchAgency already uses to email an agency once
// approved (`role = 'agency_owner'`), just batched across many agencies at
// once instead of looked up one at a time. Only active accounts, and only
// agencies with such a user come back — an agency with no owner user simply
// has no row here, which the caller treats as "can't be emailed" rather
// than an error.
//
// `full_name` was added for Audience Segments (admin.controller.js#getAgencies,
// Task 10) to show who each agency's real send target actually is by name,
// not just email. `id` was added for the FD Operations Tracker (Task 12 —
// driver-dispatch/tour-update notifications need a real recipientUserId to
// call notification.service.js#createNotification with, not just an email
// address). Existing callers (resolveRecipients above) that only
// destructure row.agency_id/row.email are unaffected by either extra column.
export async function listAgencyOwnerEmails(agencyIds) {
  if (agencyIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, agency_id, full_name, email FROM users
     WHERE agency_id IN (?) AND role = 'agency_owner' AND status = 'active'`,
    [agencyIds]
  );
  return rows;
}

export async function updateUser(id, fields) {
  const setClauses = [];
  const values = [];

  const columnMap = {
    role: 'role',
    status: 'status',
    fullName: 'full_name',
    phone: 'phone',
    whatsappNumber: 'whatsapp_number',
  };

  for (const [key, column] of Object.entries(columnMap)) {
    if (fields[key] !== undefined) {
      setClauses.push(`${column} = ?`);
      values.push(fields[key]);
    }
  }

  if (fields.permissions !== undefined) {
    setClauses.push(`permissions = ?`);
    values.push(JSON.stringify(fields.permissions));
  }

  if (setClauses.length === 0) {
    return findUserById(id);
  }

  setClauses.push('updated_at = now()');
  values.push(id);

  await pool.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`,
    values
  );
  const { rows } = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    agencyId: user.agency_id,
    role: user.role,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    whatsappNumber: user.whatsapp_number,
    status: user.status,
    permissions: user.permissions,
    // Account audit timestamps (0003_users.sql; updated_at bumped by
    // updateUser) — surfaced for the admin Employees table's Created /
    // Updated columns. Additive: every other toPublicUser consumer just
    // gains two ISO strings it can ignore.
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
