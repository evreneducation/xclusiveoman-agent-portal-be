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

export async function listAgencies({ status } = {}) {
  if (status) {
    const { rows } = await pool.query(
      'SELECT * FROM agencies WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM agencies ORDER BY created_at DESC');
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
