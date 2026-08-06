import { pool } from '../db/pool.js';
import { getIo } from '../sockets/index.js';
import {
  createPackageRequest,
  addHotelSelections,
  addTourSelections,
  addTransferSelections,
  addActivitySelections,
  addTravelers,
  listHotelsForRequest,
  listToursForRequest,
  listTransfersForRequest,
  listActivitiesForRequest,
  listTravelersForRequest,
  listPackageRequestsForAgency,
  findPackageRequestWithLeadManager,
  createDraftPackageRequest,
  updateDraftTripInfo,
  replaceHotelSelections,
  replaceTourSelections,
  replaceTransferSelections,
  replaceActivitySelections,
  replaceTravelers,
  submitDraftPackageRequest,
  deleteDraftPackageRequest,
  respondToPackageRequest,
} from '../models/packageRequests.model.js';
import { insertAuditLog, listAuditLogsForEntity } from '../models/auditLogs.model.js';
import { createNotification } from '../services/notification.service.js';

// Task 3 — FIT Notification Events (agent's own submit/accept/decline/
// revision-request actions; Lead Manager Assigned/Quote Published are the
// admin-triggered half, added in packageRequestsAdmin.controller.js). Keyed
// by respond()'s nextStatus so the one endpoint's three outcomes each notify
// with copy specific to what the agent just did.
const RESPONSE_NOTIFICATIONS = {
  accepted: {
    type: 'fit_quote_accepted',
    title: 'Quote accepted',
    message: (destination) => `You've accepted the Custom FIT quote for ${destination}.`,
  },
  revision_requested: {
    type: 'fit_revision_requested',
    title: 'Revision request sent',
    message: (destination) => `Your revision request for the ${destination} quote has been sent to our team.`,
  },
  declined: {
    type: 'fit_quote_declined',
    title: 'Quote declined',
    message: (destination) => `You've declined the Custom FIT quote for ${destination}.`,
  },
};

// Agent-facing status labels (item 2) — the DB enum itself (doc §11.4:
// draft/submitted/assigned/costed/published/accepted/revision_requested/
// declined/expired/converted) isn't renamed; these are presentation only, so
// the Admin Quote Inbox (which reads the raw `status`) is untouched.
const STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  assigned: 'Under Review',
  costed: 'Priced',
  published: 'Published',
  accepted: 'Accepted',
  revision_requested: 'Revision Requested',
  declined: 'Declined',
  expired: 'Expired',
  // FIT-13: an accepted+paid quote converts to a booking — still reads as
  // "Accepted" to the agent rather than surfacing an internal pipeline state.
  converted: 'Accepted',
};

function toListItem(row) {
  return {
    id: row.id,
    destination: row.destination,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    paxAdults: row.pax_adults,
    paxChildren: row.pax_children,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leadManager: row.lead_manager_user_id
      ? { id: row.lead_manager_user_id, fullName: row.lead_manager_full_name }
      : null,
  };
}

// Item 6 timeline — narrower than the admin Activity History: costing/markup
// edits are internal (blind pricing, FIT-6) and never surfaced to the agent.
function labelForAgentEvent(log) {
  if (log.field === 'lead_manager_user_id') return 'Lead Manager Assigned';
  if (log.field === 'status') return 'Quote Published'; // admin's publish action
  if (log.field === 'agent_response') {
    const s = log.new_value?.status;
    if (s === 'accepted') return 'Accepted';
    if (s === 'revision_requested') return 'Revision Requested';
    if (s === 'declined') return 'Declined';
  }
  return null; // net_cost_breakdown / markup_rule — admin-only, filtered out
}

// "Draft Saved" and "Submitted" are synthesized from their own audit_logs
// rows when the request actually went through the draft flow (item 1), or
// fall back to created_at for the original one-shot "submit directly" path
// (create(), below) — which never writes a 'draft_saved'/'submitted' log —
// so a request that skipped drafting still shows exactly one "Submitted".
async function buildAgentActivityHistory(row) {
  const logs = await listAuditLogsForEntity('package_request', row.id);
  const draftSavedLog = logs.find((l) => l.field === 'draft_saved');
  const submittedLog = logs.find((l) => l.field === 'submitted');

  const timeline = [];
  if (draftSavedLog) {
    timeline.push({ label: 'Draft Saved', at: draftSavedLog.created_at, by: null });
  }
  if (row.status !== 'draft') {
    timeline.push({ label: 'Submitted', at: submittedLog ? submittedLog.created_at : row.created_at, by: null });
  }
  for (const log of logs) {
    if (log.field === 'draft_saved' || log.field === 'submitted') continue; // already placed above
    const label = labelForAgentEvent(log);
    if (!label) continue;
    timeline.push({ label, at: log.created_at, by: log.actor_full_name || null });
  }

  return timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
}

// Blind pricing (doc §15 rule 65 / FIT-6): net_cost_breakdown, markup_rule,
// internal_notes and every catalog item's price field are never read into
// this response. sellPrice is the one figure FIT-10 says the agent *should*
// see, and only once the quote has actually been published (item 4).
async function toPublicPackageRequest(row) {
  const [hotels, tours, transfers, activities, travelers, activityHistory] = await Promise.all([
    listHotelsForRequest(row.id),
    listToursForRequest(row.id),
    listTransfersForRequest(row.id),
    listActivitiesForRequest(row.id),
    listTravelersForRequest(row.id),
    buildAgentActivityHistory(row),
  ]);

  const isPublishedOrLater = ['published', 'accepted', 'revision_requested', 'declined', 'converted'].includes(row.status);

  return {
    id: row.id,
    destination: row.destination,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    paxAdults: row.pax_adults,
    paxChildren: row.pax_children,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hotels: hotels.map((h) => ({
      id: h.id,
      name: h.name,
      city: h.city,
      category: h.category,
      description: h.description,
      images: h.images || [],
    })),
    tours: tours.map((t) => ({
      id: t.id,
      name: t.name,
      city: t.city,
      category: t.category,
      duration: t.duration,
      description: t.description,
      images: t.images || [],
    })),
    transfers: transfers.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      vehicleClass: t.vehicle_class,
      city: t.city,
      description: t.description,
    })),
    activities: activities.map((a) => ({
      id: a.id,
      name: a.name,
      city: a.city,
      duration: a.duration,
      description: a.description,
      images: a.images || [],
    })),
    travelers: travelers.map((t) => ({
      id: t.id,
      name: t.name,
      passportNo: t.passport_no,
      dob: t.dob,
      roomShareGroup: t.room_share_group,
      isChild: t.is_child,
    })),
    // REL-4: lead manager's contact card once assigned.
    leadManager: row.lead_manager_user_id
      ? {
          id: row.lead_manager_user_id,
          fullName: row.lead_manager_full_name,
          email: row.lead_manager_email,
          phone: row.lead_manager_phone,
          whatsappNumber: row.lead_manager_whatsapp,
        }
      : null,
    // Item 4 — Published Quote: Final Selling Price only, never the landing
    // cost/markup breakdown behind it.
    sellPrice: isPublishedOrLater && row.sell_price != null ? Number(row.sell_price) : null,
    publishedAt: isPublishedOrLater ? row.published_at : null,
    activityHistory,
  };
}

// GET /api/package-requests — "My FIT Requests / Quotes" (items 1/2/8):
// every request (draft or otherwise) belonging to the agent's own agency.
export async function list(req, res, next) {
  try {
    const rows = await listPackageRequestsForAgency(req.user.agency_id);
    res.json({ packageRequests: rows.map(toListItem) });
  } catch (err) {
    next(err);
  }
}

// POST /api/package-requests — FIT-1..FIT-7: submits the wizard in one
// atomic step (unchanged from before this task — still the "just submit,
// never saved a draft" path), landing it in the admin Quote Inbox as
// `submitted`. No 'draft_saved'/'submitted' audit rows are written here;
// buildAgentActivityHistory falls back to created_at for this path.
export async function create(req, res, next) {
  const client = await pool.connect();
  try {
    const {
      destination, dateFrom, dateTo, paxAdults, paxChildren,
      hotelIds, tourIds, transferIds, activityIds, travelers,
    } = req.body;

    await client.query('BEGIN');

    const packageRequest = await createPackageRequest(client, {
      agencyId: req.user.agency_id,
      createdByUserId: req.user.id,
      destination,
      dateFrom,
      dateTo,
      paxAdults,
      paxChildren,
    });

    await addHotelSelections(client, packageRequest.id, hotelIds);
    await addTourSelections(client, packageRequest.id, tourIds);
    await addTransferSelections(client, packageRequest.id, transferIds);
    await addActivitySelections(client, packageRequest.id, activityIds);
    await addTravelers(client, packageRequest.id, travelers);

    await client.query('COMMIT');

    // doc §13: new FIT/MICE submission — live badge counts on the admin Quote Inbox.
    getIo()?.to('role:ops_admin').emit('queue:new_item', {
      type: 'package_request',
      packageRequestId: packageRequest.id,
      destination: packageRequest.destination,
    });

    // Task 3, event 1 — FIT Request Submitted.
    await createNotification({
      recipientUserId: req.user.id,
      recipientRole: req.user.role,
      type: 'fit_request_submitted',
      title: 'FIT request submitted',
      message: `Your Custom FIT request for ${packageRequest.destination} has been submitted successfully.`,
      referenceType: 'package_request',
      referenceId: packageRequest.id,
    });

    const row = await findPackageRequestWithLeadManager(packageRequest.id);
    res.status(201).json({ packageRequest: await toPublicPackageRequest(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/package-requests/draft — item 1 "Save Draft" (starting fresh).
// Deliberately lenient (draftPackageRequestSchema) — a half-built package
// must never be lost.
export async function createDraft(req, res, next) {
  const client = await pool.connect();
  try {
    const { destination, dateFrom, dateTo, paxAdults, paxChildren, hotelIds, tourIds, transferIds, activityIds, travelers } = req.body;

    await client.query('BEGIN');
    const draft = await createDraftPackageRequest(client, {
      agencyId: req.user.agency_id,
      createdByUserId: req.user.id,
      destination, dateFrom, dateTo, paxAdults, paxChildren,
    });
    await replaceHotelSelections(client, draft.id, hotelIds);
    await replaceTourSelections(client, draft.id, tourIds);
    await replaceTransferSelections(client, draft.id, transferIds);
    await replaceActivitySelections(client, draft.id, activityIds);
    // Unfiltered, unlike submit() below — a traveler row with only a
    // passport number typed so far must still survive a draft save
    // ("a partially completed package should never be lost", item 1).
    // name defaults to '' (draftPackageRequestSchema), which satisfies the
    // NOT NULL column without inventing a placeholder value.
    await replaceTravelers(client, draft.id, travelers);
    await client.query('COMMIT');

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'package_request',
      entityId: draft.id,
      field: 'draft_saved',
      newValue: { status: 'draft' },
    });

    const row = await findPackageRequestWithLeadManager(draft.id);
    res.status(201).json({ packageRequest: await toPublicPackageRequest(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// PATCH /api/package-requests/:id — item 1 "Continue Editing" autosave.
// Only ever succeeds against a row still in 'draft' (model-level WHERE
// guard) and owned by the caller's own agency.
export async function updateDraft(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const current = await findPackageRequestWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'draft') {
      return res.status(400).json({ error: 'not_a_draft', message: 'This request has already been submitted and can no longer be edited here.' });
    }

    const { destination, dateFrom, dateTo, paxAdults, paxChildren, hotelIds, tourIds, transferIds, activityIds, travelers } = req.body;

    await client.query('BEGIN');
    const updated = await updateDraftTripInfo(client, id, { destination, dateFrom, dateTo, paxAdults, paxChildren });
    await replaceHotelSelections(client, id, hotelIds);
    await replaceTourSelections(client, id, tourIds);
    await replaceTransferSelections(client, id, transferIds);
    await replaceActivitySelections(client, id, activityIds);
    await replaceTravelers(client, id, travelers); // unfiltered — see createDraft's comment above
    await client.query('COMMIT');

    const row = updated ? await findPackageRequestWithLeadManager(updated.id) : current;
    res.json({ packageRequest: await toPublicPackageRequest(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/package-requests/:id/submit — item 1 "Submit Draft once
// completed". Re-validated with the same strict rules as the direct POST
// / create() above (destination/dates/pax/hotel/travelers), enforced by
// createPackageRequestSchema on this route (see routes file).
export async function submit(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const current = await findPackageRequestWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'draft') {
      return res.status(400).json({ error: 'not_a_draft', message: 'This request has already been submitted.' });
    }

    const { destination, dateFrom, dateTo, paxAdults, paxChildren, hotelIds, tourIds, transferIds, activityIds, travelers } = req.body;

    await client.query('BEGIN');
    await updateDraftTripInfo(client, id, { destination, dateFrom, dateTo, paxAdults, paxChildren });
    await replaceHotelSelections(client, id, hotelIds);
    await replaceTourSelections(client, id, tourIds);
    await replaceTransferSelections(client, id, transferIds);
    await replaceActivitySelections(client, id, activityIds);
    await replaceTravelers(client, id, travelers);
    const submitted = await submitDraftPackageRequest(client, id);
    await client.query('COMMIT');

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'package_request',
      entityId: id,
      field: 'submitted',
      oldValue: { status: 'draft' },
      newValue: { status: 'submitted' },
    });

    getIo()?.to('role:ops_admin').emit('queue:new_item', {
      type: 'package_request',
      packageRequestId: id,
      destination: submitted?.destination || current.destination,
    });

    // Task 3, event 1 — FIT Request Submitted (submit-from-draft path).
    await createNotification({
      recipientUserId: req.user.id,
      recipientRole: req.user.role,
      type: 'fit_request_submitted',
      title: 'FIT request submitted',
      message: `Your Custom FIT request for ${submitted?.destination || current.destination} has been submitted successfully.`,
      referenceType: 'package_request',
      referenceId: id,
    });

    const row = await findPackageRequestWithLeadManager(id);
    res.json({ packageRequest: await toPublicPackageRequest(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// DELETE /api/package-requests/:id — item 1 "Delete Draft". Scoped to
// status='draft' at the model level, so a submitted/priced/published
// request can never be deleted through this path.
export async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const current = await findPackageRequestWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'draft') {
      return res.status(400).json({ error: 'not_a_draft', message: 'Only drafts can be deleted.' });
    }
    await deleteDraftPackageRequest(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// GET /api/package-requests/:id — agent's own submission only.
export async function get(req, res, next) {
  try {
    const row = await findPackageRequestWithLeadManager(req.params.id);
    if (!row || row.agency_id !== req.user.agency_id) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ packageRequest: await toPublicPackageRequest(row) });
  } catch (err) {
    next(err);
  }
}

// POST /api/package-requests/:id/respond — item 5: Accept / Request
// Revision / Decline. Only ever fires from 'published' (model-level guard),
// matching "If the quote status is Published" in the doc.
export async function respond(req, res, next) {
  try {
    const { id } = req.params;
    const { action, comments } = req.body;

    const current = await findPackageRequestWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'published') {
      return res.status(400).json({ error: 'not_published', message: 'Only a published quote can be responded to.' });
    }

    const nextStatus = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'revision_requested';
    const updated = await respondToPackageRequest(id, nextStatus);
    if (!updated) return res.status(409).json({ error: 'conflict', message: 'This quote was just updated — please reload and try again.' });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'package_request',
      entityId: id,
      field: 'agent_response',
      oldValue: { status: current.status },
      newValue: { status: nextStatus, comments: comments || null },
    });

    // Item 7 — lets the (already-implemented) admin Quote Inbox pick this up
    // live via the same staff room used for new submissions, without needing
    // its own polling.
    getIo()?.to('role:ops_admin').emit('quote:agent_responded', {
      packageRequestId: id,
      status: nextStatus,
    });

    // Task 3, events 4/5/6 — Revision Requested / Quote Accepted / Quote Declined.
    const notif = RESPONSE_NOTIFICATIONS[nextStatus];
    await createNotification({
      recipientUserId: req.user.id,
      recipientRole: req.user.role,
      type: notif.type,
      title: notif.title,
      message: notif.message(current.destination),
      referenceType: 'package_request',
      referenceId: id,
    });

    const row = await findPackageRequestWithLeadManager(id);
    res.json({ packageRequest: await toPublicPackageRequest(row) });
  } catch (err) {
    next(err);
  }
}
