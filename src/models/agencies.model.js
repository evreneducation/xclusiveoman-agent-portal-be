const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function createAgency(client, { name, type, licenseNumber, licenseDocumentUrl, country }) {
  const id = newId();
  await client.query(
    `INSERT INTO agencies (id, name, type, license_number, license_document_url, country, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [id, name, type, licenseNumber || null, licenseDocumentUrl || null, country]
  );
  const { rows } = await client.query('SELECT * FROM agencies WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createAgency = createAgency;

async function findAgencyById(id) {
  const { rows } = await pool.query('SELECT * FROM agencies WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.findAgencyById = findAgencyById;

async function listAgencies({ status, country, inactiveSinceDays, agencyIds } = {}) {
  const params = [];
  const conditions = [];
  if (status) {
    params.push(status);
    conditions.push(`a.status = ?`);
  }
  if (agencyIds) {
    params.push(agencyIds);
    conditions.push(`a.id IN (?)`);
  }
  if (country) {
    params.push(country);
    conditions.push(`a.country = ?`);
  }
  if (inactiveSinceDays) {
    params.push(inactiveSinceDays, inactiveSinceDays, inactiveSinceDays);
    conditions.push(`
      NOT EXISTS (SELECT 1 FROM bookings b WHERE b.agency_id = a.id AND b.created_at >= now() - INTERVAL ? DAY)
      AND NOT EXISTS (SELECT 1 FROM package_requests pr WHERE pr.agency_id = a.id AND pr.created_at >= now() - INTERVAL ? DAY)
      AND NOT EXISTS (SELECT 1 FROM mice_rfqs m WHERE m.agency_id = a.id AND m.created_at >= now() - INTERVAL ? DAY)
    `);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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

module.exports.listAgencies = listAgencies;

async function listAgenciesByRmIds(rmUserIds) {
  if (rmUserIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, name, rm_user_id FROM agencies WHERE rm_user_id IN (?) ORDER BY name`,
    [rmUserIds]
  );
  return rows;
}

module.exports.listAgenciesByRmIds = listAgenciesByRmIds;

async function findRmEmailsByAgencyIds(agencyIds) {
  if (agencyIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT a.id AS agency_id, rm.email AS rm_email
     FROM agencies a
     LEFT JOIN users rm ON rm.id = a.rm_user_id
     WHERE a.id IN (?) AND rm.email IS NOT NULL`,
    [agencyIds]
  );
  return rows;
}

module.exports.findRmEmailsByAgencyIds = findRmEmailsByAgencyIds;

async function updateAgency(id, fields) {
  const setClauses = [];
  const values = [];

  const columnMap = {
    status: 'status',
    creditLimit: 'credit_limit',
    rmUserId: 'rm_user_id',
    name: 'name',
    country: 'country',
    logoAssetUrl: 'logo_asset_url',
    currencyPreference: 'currency_preference',
  };

  for (const [key, column] of Object.entries(columnMap)) {
    if (fields[key] !== undefined) {
      setClauses.push(`${column} = ?`);
      values.push(fields[key]);
    }
  }

  if (setClauses.length === 0) {
    return findAgencyById(id);
  }

  setClauses.push(`updated_at = now()`);
  values.push(id);

  await pool.query(`UPDATE agencies SET ${setClauses.join(', ')} WHERE id = ?`, values);
  const { rows } = await pool.query('SELECT * FROM agencies WHERE id = ?', [id]);
  return rows[0] || null;
}

module.exports.updateAgency = updateAgency;
