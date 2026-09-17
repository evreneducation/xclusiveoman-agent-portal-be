const {
  pool
} = require('../db/pool.js');

const {
  env
} = require('../config/env.js');

const {
  listAgencies,
  findAgencyById,
  listAgenciesByRmIds,
  updateAgency
} = require('../models/agencies.model.js');

const {
  findUserById,
  listAgencyOwnerEmails
} = require('../models/users.model.js');

const {
  sendEmail
} = require('../services/email.service.js');

const {
  buildAgentApprovedEmailHtml
} = require('../services/emailTemplate.service.js');

const {
  pickNextRoundRobinRm
} = require('../services/rmAssignment.service.js');

const {
  getIo
} = require('../sockets/index.js');

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

async function getAgencies(req, res, next) {
  try {
    // This is admin data an approve/reject action can change from one
    // request to the next — no reason for the browser to conditionally
    // cache it at all (Express's default per-response ETag was otherwise
    // making a repeat visit to an already-seen page/filter come back as a
    // harmless-but-pointless 304). Same pattern as
    // marketingTracking.controller.js's own Cache-Control header.
    res.set('Cache-Control', 'no-store');
    const { status, country, search } = req.query;
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

    const rows = agencyIds && agencyIds.length === 0 ? [] : await listAgencies({ status, country, inactiveSinceDays, agencyIds });

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
        [a.name, a.ownerName, a.ownerEmail, a.country, a.licenseNumber].some((v) => v && v.toLowerCase().includes(needle))
      );
    }

    // Pagination (Agent Approvals table view) — opt-in via ?page=/?pageSize=,
    // same param names and { total, page, pageSize, totalPages } response
    // shape as supportTicketsAdmin.controller.js's own pagination, for
    // consistency across the admin API rather than a one-off shape here.
    // Applied last, after every filter above (status/country/
    // inactiveSinceDays are SQL WHERE clauses in listAgencies; search is
    // JS-side here since it needs the owner join). Every *other* existing
    // caller of this same endpoint — Team Portal's Approved Agents page,
    // Marketing Center's audience counts, the admin Dashboard — calls it
    // with neither param and still gets back the full filtered list
    // unchanged (no `pagination` key in the response either), so none of
    // them silently truncate to a page of 10.
    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paginate) {
      return res.json({ agencies });
    }
    const total = agencies.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 10));
    const start = (page - 1) * pageSize;
    agencies = agencies.slice(start, start + pageSize);

    res.json({ agencies, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (err) {
    next(err);
  }
}

module.exports.getAgencies = getAgencies;

async function patchAgency(req, res, next) {
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
        `SELECT * FROM users WHERE agency_id = ? AND role = 'agency_owner' LIMIT 1`,
        [id]
      );
      const owner = rows[0];
      if (owner) {
        // Best-effort — an email-send hiccup must never fail the approval itself,
        // which has already been durably written by updateAgency() above
        // (same posture as auth.controller.js#notifyAdminsOfNewAgent).
        try {
          // The RM this same approval just assigned (either the round-robin
          // pick above or an explicit rmUserId override) — looked up fresh
          // off the just-updated agency row rather than patch.rmUserId, so
          // this is always the RM that actually landed in the DB.
          const rm = agency.rm_user_id ? await findUserById(agency.rm_user_id) : null;
          const rmDetails = rm ? { fullName: rm.full_name, email: rm.email, phone: rm.phone } : null;

          const { html, attachments } = buildAgentApprovedEmailHtml({
            fullName: owner.full_name,
            agencyName: agency.name,
            loginUrl: env.agentLoginUrl,
            rm: rmDetails,
          });
          await sendEmail({
            to: owner.email,
            subject: 'Your Xclusive Oman agency has been approved',
            text: `Good news — ${agency.name} has been approved. Sign in at ${env.agentLoginUrl}.${rmDetails ? ` Your Relationship Manager: ${rmDetails.fullName} (${rmDetails.email}).` : ''}`,
            html,
            attachments,
          });
        } catch (err) {
          console.error('Failed to send agency-approved email', agency.id, err);
        }
        getIo()?.to(`user:${owner.id}`).emit('notification:new', {
          type: 'agency_approved',
          title: 'Agency approved',
          body: `Welcome to Xclusive Oman, ${agency.name} has been approved.`,
        });
      }
    }

    res.json({ agency: toAdminAgency(agency) });
  } catch (err) {
    next(err);
  }
}

module.exports.patchAgency = patchAgency;
