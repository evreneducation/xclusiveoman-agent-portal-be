import { pool } from '../db/pool.js';

export async function createAgency(client, { name, type, licenseNumber, country }) {
  const { rows } = await client.query(
    `INSERT INTO agencies (name, type, license_number, country, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [name, type, licenseNumber || null, country]
  );
  return rows[0];
}

export async function findAgencyById(id) {
  const { rows } = await pool.query('SELECT * FROM agencies WHERE id = $1', [id]);
  return rows[0] || null;
}

// Joins in the assigned RM's name/email (rather than making the caller do a
// second lookup) since the admin Agent Approvals list needs to show who each
// agency is allotted to.
export async function listAgencies({ status } = {}) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = 'WHERE a.status = $1';
  }
  const { rows } = await pool.query(
    `SELECT a.*, rm.full_name AS rm_full_name, rm.email AS rm_email
     FROM agencies a
     LEFT JOIN users rm ON rm.id = a.rm_user_id
     ${where}
     ORDER BY a.created_at DESC`,
    params
  );
  return rows;
}

// Used to annotate each Relationship Manager with the agencies currently
// assigned to them (agencies.rm_user_id), rather than a separate join table.
export async function listAgenciesByRmIds(rmUserIds) {
  if (rmUserIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, name, rm_user_id FROM agencies WHERE rm_user_id = ANY($1::uuid[]) ORDER BY name`,
    [rmUserIds]
  );
  return rows;
}

export async function updateAgency(id, fields) {
  const setClauses = [];
  const values = [];
  let i = 1;

  const columnMap = {
    status: 'status',
    tier: 'tier',
    creditLimit: 'credit_limit',
    rmUserId: 'rm_user_id',
    name: 'name',
    country: 'country',
    logoAssetUrl: 'logo_asset_url',
    currencyPreference: 'currency_preference',
  };

  for (const [key, column] of Object.entries(columnMap)) {
    if (fields[key] !== undefined) {
      setClauses.push(`${column} = $${i}`);
      values.push(fields[key]);
      i += 1;
    }
  }

  if (setClauses.length === 0) {
    return findAgencyById(id);
  }

  setClauses.push(`updated_at = now()`);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE agencies SET ${setClauses.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  return rows[0] || null;
}
