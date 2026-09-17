const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function createUser(
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

module.exports.createUser = createUser;

async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = ?', [
    email.toLowerCase(),
  ]);
  return rows[0] || null;
}

module.exports.findUserByEmail = findUserByEmail;

async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.findUserById = findUserById;

async function listStaff() {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id IS NULL ORDER BY created_at DESC`
  );
  return rows;
}

module.exports.listStaff = listStaff;

async function listStaffByRole(role) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id IS NULL AND role = ? ORDER BY created_at DESC`,
    [role]
  );
  return rows;
}

module.exports.listStaffByRole = listStaffByRole;

async function listAgencyUsers(agencyId) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id = ? ORDER BY created_at DESC`,
    [agencyId]
  );
  return rows;
}

module.exports.listAgencyUsers = listAgencyUsers;

async function listAgencyOwnerEmails(agencyIds) {
  if (agencyIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, agency_id, full_name, email FROM users
     WHERE agency_id IN (?) AND role = 'agency_owner' AND status = 'active'`,
    [agencyIds]
  );
  return rows;
}

module.exports.listAgencyOwnerEmails = listAgencyOwnerEmails;

async function updateUser(id, fields) {
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

module.exports.updateUser = updateUser;

function toPublicUser(user) {
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

module.exports.toPublicUser = toPublicUser;
