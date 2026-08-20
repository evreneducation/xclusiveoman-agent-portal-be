import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import { listAgencies, findAgencyById, listAgenciesByRmIds, updateAgency } from '../models/agencies.model.js';
import { findUserById, listAgencyOwnerEmails } from '../models/users.model.js';
import { sendEmail } from '../services/email.service.js';
import { buildAgentApprovedEmailHtml } from '../services/emailTemplate.service.js';
import { pickNextRoundRobinRm } from '../services/rmAssignment.service.js';
import { getIo } from '../sockets/index.js';

// `owner` (Task 10 — Audience Segments) is the agency's active
// agency_owner row from listAgencyOwnerEmails, when the caller has one to
// pass; omitted entirely (as patchAgency below still does) it's simply
// `undefined` and ownerName/ownerEmail come back null — a purely additive
// field, no existing caller's response shape is narrowed or changed.
function toAdminAgency(agency, owner) {
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
    ownerName: owner?.full_name ?? null,
    ownerEmail: owner?.email ?? null,
    createdAt: agency.created_at,
  };
}

// GET /api/admin/agencies?status=&tier=&country=&inactiveSinceDays=&search=
// — tier/country/inactiveSinceDays back Marketing Center's four audience
// segments. listAgencies() already accepted tier/country (added for, and
// still shared with, services/marketingSend.service.js#resolveAudience —
// the same function that resolves an actual campaign's real recipients);
// this handler simply forwards them from the query string now too (Task 10
// — Audience Segments), same as `status`/`inactiveSinceDays` already were.
// A segment's shown count/members can therefore never drift from what
// sending to it would actually do — both read the exact same WHERE clauses.
//
// `search` (Task 10) is a free-text match over agency name / owner name /
// owner email, applied here in JS rather than in listAgencies' SQL — it
// needs the owner data this handler already joins in below (listAgencies
// itself only ever joins the assigned RM, not the owner), and it only ever
// narrows an already-segment-filtered result, never decides segment
// membership itself (that's still 100% the SQL WHERE clauses above).
// Parsed manually rather than through the validateBody/zod schemas (those
// are only used on writes in this codebase) — an unrecognised/invalid
// value for any of these is simply ignored, falling through to "no filter",
// same as `status` already did.
export async function getAgencies(req, res, next) {
  try {
    const { status, tier, country, search } = req.query;
    const inactiveSinceDaysNum = Number(req.query.inactiveSinceDays);
    const inactiveSinceDays = Number.isInteger(inactiveSinceDaysNum) && inactiveSinceDaysNum > 0 ? inactiveSinceDaysNum : undefined;

    // Team Portal's Approved Agents page (Access Feature 'approvedAgents',
    // requireFeature — admin.routes.js) — a Relationship Manager only ever
    // sees their own book, "by his record" per the feature's own name, never
    // the full agency directory this same endpoint otherwise serves every
    // other staff role. Scoped here, server-side, off req.user.id — not a
    // client-suppliable filter (see listAgencies' own comment on agencyIds).
    let agencyIds;
    if (req.user.role === 'relationship_manager') {
      const own = await listAgenciesByRmIds([req.user.id]);
      agencyIds = own.map((a) => a.id);
    }

    const rows = agencyIds && agencyIds.length === 0 ? [] : await listAgencies({ status, tier, country, inactiveSinceDays, agencyIds });

    // Task 10 — each agency's real send target (its active owner's
    // name/email — the same account resolveRecipients() would actually
    // email), for display. An agency with no active owner shows
    // ownerName/ownerEmail as null rather than being dropped from this
    // list — unlike an actual campaign send, this is a directory view, not
    // a recipient list, so a not-currently-emailable agency still belongs
    // in it.
    const ownerRows = await listAgencyOwnerEmails(rows.map((r) => r.id));
    const ownerByAgency = new Map(ownerRows.map((r) => [r.agency_id, r]));

    let agencies = rows.map((r) => toAdminAgency(r, ownerByAgency.get(r.id)));

    if (search) {
      const needle = search.trim().toLowerCase();
      agencies = agencies.filter((a) =>
        [a.name, a.ownerName, a.ownerEmail, a.country].some((v) => v && v.toLowerCase().includes(needle))
      );
    }

    res.json({ agencies });
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
        // Best-effort — an SMTP hiccup must never fail the approval itself,
        // which has already been durably written by updateAgency() above
        // (same posture as auth.controller.js#notifyAdminsOfNewAgent).
        try {
          const { html, attachments } = buildAgentApprovedEmailHtml({
            fullName: owner.full_name,
            agencyName: agency.name,
            tier: agency.tier,
            loginUrl: env.agentLoginUrl,
          });
          await sendEmail({
            to: owner.email,
            subject: 'Your Xclusive Oman agency has been approved',
            text: `Good news — ${agency.name} has been approved${agency.tier ? ` at ${agency.tier} tier` : ''}. Sign in at ${env.agentLoginUrl}.`,
            html,
            attachments,
          });
        } catch (err) {
          console.error('Failed to send agency-approved email', agency.id, err);
        }
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
