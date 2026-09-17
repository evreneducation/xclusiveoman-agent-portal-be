const {
  pool
} = require('../db/pool.js');

const {
  findAgencyById,
  updateAgency
} = require('../models/agencies.model.js');

const {
  createUser,
  findUserByEmail,
  listAgencyUsers,
  toPublicUser
} = require('../models/users.model.js');

function toPublicAgency(agency, rm) {
  return {
    id: agency.id,
    name: agency.name,
    type: agency.type,
    licenseNumber: agency.license_number,
    country: agency.country,
    status: agency.status,
    creditLimit: agency.credit_limit,
    currencyPreference: agency.currency_preference,
    logoAssetUrl: agency.logo_asset_url,
    relationshipManager: rm ? toPublicUser(rm) : null,
    createdAt: agency.created_at,
  };
}

async function getMyAgency(req, res, next) {
  try {
    const agency = await findAgencyById(req.user.agency_id);
    if (!agency) {
      return res.status(404).json({ error: 'not_found' });
    }

    let rm = null;
    if (agency.rm_user_id) {
      const { rows } = await pool.query('SELECT * FROM users WHERE id = ?', [agency.rm_user_id]);
      rm = rows[0] || null;
    }

    res.json({ agency: toPublicAgency(agency, rm) });
  } catch (err) {
    next(err);
  }
}

module.exports.getMyAgency = getMyAgency;

async function patchMyAgency(req, res, next) {
  try {
    const { name, country, logoAssetUrl, currencyPreference } = req.body;
    const agency = await updateAgency(req.user.agency_id, {
      name,
      country,
      logoAssetUrl,
      currencyPreference,
    });
    res.json({ agency: toPublicAgency(agency) });
  } catch (err) {
    next(err);
  }
}

module.exports.patchMyAgency = patchMyAgency;

async function createSubUser(req, res, next) {
  const client = await pool.connect();
  try {
    const { fullName, email, phone, permissions } = req.body;

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'conflict', message: 'Email already registered' });
    }

    const user = await createUser(client, {
      agencyId: req.user.agency_id,
      role: 'agency_staff',
      fullName,
      email,
      phone,
      permissions,
    });

    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

module.exports.createSubUser = createSubUser;

async function listMySubUsers(req, res, next) {
  try {
    const users = await listAgencyUsers(req.user.agency_id);
    res.json({ users: users.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

module.exports.listMySubUsers = listMySubUsers;
