import { pool } from '../db/pool.js';
import { listAgencies, findAgencyById, updateAgency } from '../models/agencies.model.js';
import { findUserById } from '../models/users.model.js';
import { sendEmail } from '../services/email.service.js';
import { pickNextRoundRobinRm } from '../services/rmAssignment.service.js';
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
    rmName: agency.rm_full_name ?? null,
    rmEmail: agency.rm_email ?? null,
    createdAt: agency.created_at,
  };
}

// GET /api/admin/agencies?status=&inactiveSinceDays= — the latter backs
// Marketing Center's "Inactive 30+ days" audience segment (see
// listAgencies' comment for what "inactive" means here). Parsed manually
// rather than through the validateBody/zod schemas (those are only used on
// writes in this codebase) — a non-numeric or non-positive value is simply
// ignored, same as an unrecognised `status` value already falls through to
// "no filter" today.
export async function getAgencies(req, res, next) {
  try {
    const { status } = req.query;
    const inactiveSinceDaysNum = Number(req.query.inactiveSinceDays);
    const inactiveSinceDays = Number.isInteger(inactiveSinceDaysNum) && inactiveSinceDaysNum > 0 ? inactiveSinceDaysNum : undefined;
    const agencies = await listAgencies({ status, inactiveSinceDays });
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

    const statusJustChangedToApproved = req.body.status === 'approved' && existing.status !== 'approved';

    // REL-1: RM assignment is automatic round-robin on approval — admin
    // doesn't pick one. An explicit rmUserId in the same request (e.g. a
    // deliberate manual override) still wins.
    const patch = { ...req.body };
    if (statusJustChangedToApproved && !patch.rmUserId) {
      const rmUserId = await pickNextRoundRobinRm();
      if (rmUserId) patch.rmUserId = rmUserId;
    }

    const agency = await updateAgency(id, patch);

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
