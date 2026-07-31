import { pool } from '../db/pool.js';

export async function createUser(
  client,
  { agencyId, role, fullName, email, phone, whatsappNumber, passwordHash, permissions }
) {
  const { rows } = await client.query(
    `INSERT INTO users (agency_id, role, full_name, email, phone, whatsapp_number, password_hash, permissions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, '{}'::jsonb))
     RETURNING *`,
    [
      agencyId || null,
      role,
      fullName,
      email.toLowerCase(),
      phone || null,
      whatsappNumber || null,
      passwordHash,
      permissions ? JSON.stringify(permissions) : null,
    ]
  );
  return rows[0];
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function listStaff() {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id IS NULL ORDER BY created_at DESC`
  );
  return rows;
}

export async function listAgencyUsers(agencyId) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE agency_id = $1 ORDER BY created_at DESC`,
    [agencyId]
  );
  return rows;
}

export async function updateUser(id, fields) {
  const setClauses = [];
  const values = [];
  let i = 1;

  const columnMap = {
    role: 'role',
    status: 'status',
    fullName: 'full_name',
    phone: 'phone',
    whatsappNumber: 'whatsapp_number',
    passwordHash: 'password_hash',
  };

  for (const [key, column] of Object.entries(columnMap)) {
    if (fields[key] !== undefined) {
      setClauses.push(`${column} = $${i}`);
      values.push(fields[key]);
      i += 1;
    }
  }

  if (fields.permissions !== undefined) {
    setClauses.push(`permissions = $${i}`);
    values.push(JSON.stringify(fields.permissions));
    i += 1;
  }

  if (setClauses.length === 0) {
    return findUserById(id);
  }

  setClauses.push('updated_at = now()');
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
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
  };
}
