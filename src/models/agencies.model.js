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
//
// `inactiveSinceDays` (Marketing Center's "Inactive 30+ days" audience
// segment) filters down to agencies with no booking, FIT package request, or
// MICE RFQ created in that many days (or ever) — the three tables that
// actually record "this agency did something"; there's no last_login_at or
// similar on agencies/users to check instead. `tier`/`country` are the same
// idea for the "By Tier"/"By Country" segments — plain equality filters, so
// this one function is the single source of truth for every Marketing
// Center audience segment (Task 3's UI counts and Task 5's server-side send
// audience resolution both call this, and so can never disagree). Kept as
// extra optional WHERE clauses on this same list rather than a separate
// endpoint, matching how `status` already narrows this list and how the
// Product/MICE catalog list endpoints take extra filter query params
// instead of growing new single-purpose routes.
// `agencyIds` (Team Portal's Approved Agents page, relationshipManagers
// scoping — admin.controller.js#getAgencies) restricts the list to a
// specific RM's own assigned agencies (agencies.rm_user_id) — set
// server-side from the requesting RM's own id, never a client-supplied
// filter, so one RM can never page through another RM's book by tampering
// with a query param.
export async function listAgencies({ status, tier, country, inactiveSinceDays, agencyIds } = {}) {
  const params = [];
  const conditions = [];
  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (agencyIds) {
    params.push(agencyIds);
    conditions.push(`a.id = ANY($${params.length}::uuid[])`);
  }
  if (tier) {
    params.push(tier);
    conditions.push(`a.tier = $${params.length}`);
  }
  if (country) {
    params.push(country);
    conditions.push(`a.country = $${params.length}`);
  }
  if (inactiveSinceDays) {
    params.push(inactiveSinceDays);
    const p = `$${params.length}`;
    conditions.push(`
      NOT EXISTS (SELECT 1 FROM bookings b WHERE b.agency_id = a.id AND b.created_at >= now() - (${p}::int * interval '1 day'))
      AND NOT EXISTS (SELECT 1 FROM package_requests pr WHERE pr.agency_id = a.id AND pr.created_at >= now() - (${p}::int * interval '1 day'))
      AND NOT EXISTS (SELECT 1 FROM mice_rfqs m WHERE m.agency_id = a.id AND m.created_at >= now() - (${p}::int * interval '1 day'))
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

// Marketing Center campaign sending (services/marketingSend.service.js) —
// resolves each agency's *current* assigned Relationship Manager email for
// the reply-to-account-manager option, looked up fresh at actual send time
// (not a snapshot taken when a campaign was composed/scheduled) so a later
// RM reassignment is honored. Same batched shape as listAgenciesByRmIds
// above, just the reverse direction (agency -> its RM's email).
export async function findRmEmailsByAgencyIds(agencyIds) {
  if (agencyIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT a.id AS agency_id, rm.email AS rm_email
     FROM agencies a
     LEFT JOIN users rm ON rm.id = a.rm_user_id
     WHERE a.id = ANY($1::uuid[]) AND rm.email IS NOT NULL`,
    [agencyIds]
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
