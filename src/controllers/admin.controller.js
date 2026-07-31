import { pool } from '../db/pool.js';
import { listAgencies, findAgencyById, updateAgency } from '../models/agencies.model.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  listStaff,
  toPublicUser,
  updateUser,
} from '../models/users.model.js';
import { hashPassword } from '../services/auth.service.js';
import { sendEmail } from '../services/email.service.js';
import { getIo } from '../sockets/index.js';

function toAdminAgency(agency) {
  return {
    id: agency.id,
    name: agency.name,
    type: agency.type,
    licenseNumber: agency.license_number,
    country: agency.country,
    tier: agency.tier,
    status: agency.status,
    creditLimit: agency.credit_limit,
    currencyPreference: agency.currency_preference,
    rmUserId: agency.rm_user_id,
    createdAt: agency.created_at,
  };
}

// GET /api/admin/agencies?status=
export async function getAgencies(req, res, next) {
  try {
    const { status } = req.query;
    const agencies = await listAgencies({ status });
    res.json({ agencies: agencies.map(toAdminAgency) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/agencies/:id — ADM-6 / AUTH-2: approve/reject + tier + credit + RM, in one step.
export async function patchAgency(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await findAgencyById(id);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (req.body.rmUserId) {
      const rm = await findUserById(req.body.rmUserId);
      if (!rm || rm.agency_id !== null) {
        return res.status(400).json({ error: 'invalid_rm', message: 'rmUserId must be an internal staff user' });
      }
    }

    const agency = await updateAgency(id, req.body);

    const statusJustChangedToApproved = req.body.status === 'approved' && existing.status !== 'approved';
    if (statusJustChangedToApproved) {
      const { rows } = await pool.query(
        `SELECT * FROM users WHERE agency_id = $1 AND role = 'agency_owner' LIMIT 1`,
        [id]
      );
      const owner = rows[0];
      if (owner) {
        await sendEmail({
          to: owner.email,
          subject: 'Your Xclusive Oman agency has been approved',
          text: `Good news — ${agency.name} has been approved${agency.tier ? ` at ${agency.tier} tier` : ''}. You can now log in.`,
        });
        getIo()?.to(`user:${owner.id}`).emit('notification:new', {
          type: 'agency_approved',
          title: 'Agency approved',
          body: `Welcome to Xclusive Oman, tier: ${agency.tier || 'unassigned'}`,
        });
      }
    }

    res.json({ agency: toAdminAgency(agency) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/team
export async function getTeam(req, res, next) {
  try {
    const staff = await listStaff();
    res.json({ team: staff.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/team
export async function createTeamMember(req, res, next) {
  const client = await pool.connect();
  try {
    const { fullName, email, password, phone, whatsappNumber, role, permissions } = req.body;

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'conflict', message: 'Email already registered' });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser(client, {
      agencyId: null,
      role,
      fullName,
      email,
      phone,
      whatsappNumber,
      passwordHash,
      permissions,
    });

    res.status(201).json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  } finally {
    client.release();
  }
}

// PATCH /api/admin/team/:id
export async function patchTeamMember(req, res, next) {
  try {
    const { id } = req.params;
    const target = await findUserById(id);
    if (!target || target.agency_id !== null) {
      return res.status(404).json({ error: 'not_found' });
    }

    const user = await updateUser(id, req.body);
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}
