import { pool } from '../db/pool.js';
import { getIo } from '../sockets/index.js';
import {
  createMiceRfq,
  addHotelSelections,
  addTourSelections,
  addTransferSelections,
  addActivitySelections,
  listHotelsForRfq,
  listToursForRfq,
  listTransfersForRfq,
  listActivitiesForRfq,
  listMiceRfqsForAgency,
  findMiceRfqWithLeadManager,
  createDraftMiceRfq,
  updateDraftMiceRfqInfo,
  replaceHotelSelections,
  replaceTourSelections,
  replaceTransferSelections,
  replaceActivitySelections,
  submitDraftMiceRfq,
  deleteDraftMiceRfq,
  respondToMiceRfq,
  listItineraryForRfq,
  replaceItinerary,
  composeItinerary,
} from '../models/miceRfqs.model.js';
import { insertAuditLog, listAuditLogsForEntity } from '../models/auditLogs.model.js';
import { createNotification } from '../services/notification.service.js';

// Task 4 — MICE Notification Events (agent's own submit/accept/decline/
// revision-request actions; Lead Manager Assigned/Proposal Published are the
// admin-triggered half, added in miceRfqsAdmin.controller.js). Mirrors
// packageRequests.controller.js's RESPONSE_NOTIFICATIONS exactly, keyed by
// respond()'s nextStatus so the one endpoint's three outcomes each notify
// with copy specific to what the agent just did.
const RESPONSE_NOTIFICATIONS = {
  accepted: {
    type: 'mice_proposal_accepted',
    title: 'Proposal accepted',
    message: (destination) => `You've accepted the MICE proposal for ${destination}.`,
  },
  revision_requested: {
    type: 'mice_revision_requested',
    title: 'Revision request sent',
    message: (destination) => `Your revision request for the ${destination} proposal has been sent to our team.`,
  },
  declined: {
    type: 'mice_proposal_declined',
    title: 'Proposal declined',
    message: (destination) => `You've declined the MICE proposal for ${destination}.`,
  },
};

// Agent-facing status labels (item 2). The DB enum itself isn't renamed —
// this is presentation only, so the Admin MICE Request Management screen
// (which reads the raw `status`, untouched by this task) is unaffected.
// "Under Review" is derived from (status, leadManager) rather than its own
// enum value, so it doesn't require any change to the admin's
// assignLeadManager (which still never writes a status transition).
const STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  rfp_dispatched: 'Under Review',
  supplier_responses_pending: 'Under Review',
  supplier_responses_received: 'Under Review',
  costed: 'Priced',
  published: 'Published',
  accepted: 'Accepted',
  revision_requested: 'Revision Requested',
  negotiating: 'Negotiating',
  declined: 'Declined',
  expired: 'Expired',
  // MICE-14: an accepted+paid RFQ converts to a booking — still reads as
  // "Accepted" to the agent rather than surfacing an internal pipeline state.
  converted: 'Accepted',
};

function statusLabelFor(row) {
  if (row.status === 'submitted' && row.lead_manager_user_id) return 'Under Review';
  return STATUS_LABELS[row.status] || row.status;
}

function toListItem(row) {
  return {
    id: row.id,
    destination: row.destination,
    groupSize: row.group_size,
    eventDateFrom: row.event_date_from,
    eventDateTo: row.event_date_to,
    status: row.status,
    statusLabel: statusLabelFor(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leadManager: row.lead_manager_user_id
      ? { id: row.lead_manager_user_id, fullName: row.lead_manager_full_name }
      : null,
  };
}

// Item 6 timeline — narrower than the admin Activity Timeline: costing/
// markup edits are internal (blind pricing) and never surfaced to the agent.
function labelForAgentEvent(log) {
  if (log.field === 'lead_manager_user_id') return 'Lead Manager Assigned';
  if (log.field === 'status') return 'Proposal Published'; // admin's publish action
  if (log.field === 'agent_response') {
    const s = log.new_value?.status;
    if (s === 'accepted') return 'Accepted';
    if (s === 'revision_requested') return 'Revision Requested';
    if (s === 'declined') return 'Declined';
  }
  return null; // cost_breakdown / markup_rule — admin-only, filtered out
}

// "Draft Saved" and "Submitted" are synthesized from their own audit_logs
// rows when the request actually went through the draft flow, or fall back
// to created_at for the direct "submit immediately" path (create(), below)
// — which never writes a 'draft_saved'/'submitted' log — so a request that
// skipped drafting still shows exactly one "Submitted".
async function buildAgentActivityHistory(row) {
  const logs = await listAuditLogsForEntity('mice_rfq', row.id);
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

// Blind pricing (mirrors packageRequests.controller.js#toPublicPackageRequest):
// net_cost_total, cost_breakdown, markup_rule, internal_notes and every
// catalog item's price field are never read into this response. sellPrice is
// the one figure item 4 says the agent *should* see, and only once the
// proposal has actually been published.
async function toPublicMiceRfq(row) {
  const [hotels, tours, transfers, activities, activityHistory, itinerary] = await Promise.all([
    listHotelsForRfq(row.id),
    listToursForRfq(row.id),
    listTransfersForRfq(row.id),
    listActivitiesForRfq(row.id),
    buildAgentActivityHistory(row),
    listItineraryForRfq(row.id),
  ]);

  const isPublishedOrLater = ['published', 'accepted', 'revision_requested', 'declined', 'converted'].includes(row.status);

  return {
    id: row.id,
    destination: row.destination,
    groupSize: row.group_size,
    eventDateFrom: row.event_date_from,
    eventDateTo: row.event_date_to,
    hallCapacityNeeded: row.hall_capacity_needed,
    seatingStyle: row.seating_style,
    avNeeds: row.av_needs,
    otherRequirements: row.other_requirements,
    status: row.status,
    statusLabel: statusLabelFor(row),
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
    // Day-wise Itinerary Planner — same composeItinerary the agent builder's
    // own local equivalent mirrors while editing, and the shape QuoteDetail's
    // ItineraryTimeline already knows how to render.
    itinerary: composeItinerary(itinerary.days, itinerary.items, { hotel: hotels, tour: tours, transfer: transfers, activity: activities }),
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
    // Item 4 — Published Proposal: Final Selling Price only, never the
    // landing cost/markup/internal notes behind it.
    sellPrice: isPublishedOrLater && row.sell_price != null ? Number(row.sell_price) : null,
    publishedAt: isPublishedOrLater ? row.published_at : null,
    activityHistory,
  };
}

// GET /api/mice/rfqs — "My MICE Requests" (items 1/2/3): every request
// (draft or otherwise) belonging to the agent's own agency.
export async function list(req, res, next) {
  try {
    const rows = await listMiceRfqsForAgency(req.user.agency_id);
    res.json({ miceRfqs: rows.map(toListItem) });
  } catch (err) {
    next(err);
  }
}

// POST /api/mice/rfqs — MICE-7: submits the curation in one atomic step
// (unchanged from Task 1 — still the "just submit, never saved a draft"
// path), landing it in the admin MICE Request Management inbox as
// `submitted`. No 'draft_saved'/'submitted' audit rows are written here;
// buildAgentActivityHistory falls back to created_at for this path.
export async function create(req, res, next) {
  const client = await pool.connect();
  try {
    const {
      destination, groupSize, eventDateFrom, eventDateTo,
      hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
      hotelIds, tourIds, transferIds, activityIds, itinerary,
    } = req.body;

    await client.query('BEGIN');

    const rfq = await createMiceRfq(client, {
      agencyId: req.user.agency_id,
      createdByUserId: req.user.id,
      destination,
      groupSize,
      eventDateFrom,
      eventDateTo,
      hallCapacityNeeded,
      seatingStyle,
      avNeeds,
      otherRequirements,
    });

    await addHotelSelections(client, rfq.id, hotelIds);
    await addTourSelections(client, rfq.id, tourIds);
    await addTransferSelections(client, rfq.id, transferIds);
    await addActivitySelections(client, rfq.id, activityIds);
    await replaceItinerary(client, rfq.id, itinerary);

    await client.query('COMMIT');

    // doc §13: new FIT/MICE submission — live badge counts on the admin inbox.
    getIo()?.to('role:ops_admin').emit('queue:new_item', {
      type: 'mice_rfq',
      miceRfqId: rfq.id,
      destination: rfq.destination,
    });

    // Task 4, event 1 — MICE Request Submitted.
    await createNotification({
      recipientUserId: req.user.id,
      recipientRole: req.user.role,
      type: 'mice_request_submitted',
      title: 'MICE request submitted',
      message: `Your MICE request for ${rfq.destination} has been submitted successfully.`,
      referenceType: 'mice_rfq',
      referenceId: rfq.id,
    });

    const row = await findMiceRfqWithLeadManager(rfq.id);
    res.status(201).json({ miceRfq: await toPublicMiceRfq(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/mice/rfqs/draft — item 1 "Save Draft" (starting fresh).
// Deliberately lenient (draftMiceRfqSchema) — a half-built RFQ must never be
// lost.
export async function createDraft(req, res, next) {
  const client = await pool.connect();
  try {
    const {
      destination, groupSize, eventDateFrom, eventDateTo,
      hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
      hotelIds, tourIds, transferIds, activityIds, itinerary,
    } = req.body;

    await client.query('BEGIN');
    const draft = await createDraftMiceRfq(client, {
      agencyId: req.user.agency_id,
      createdByUserId: req.user.id,
      destination, groupSize, eventDateFrom, eventDateTo,
      hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
    });
    await replaceHotelSelections(client, draft.id, hotelIds);
    await replaceTourSelections(client, draft.id, tourIds);
    await replaceTransferSelections(client, draft.id, transferIds);
    await replaceActivitySelections(client, draft.id, activityIds);
    await replaceItinerary(client, draft.id, itinerary);
    await client.query('COMMIT');

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'mice_rfq',
      entityId: draft.id,
      field: 'draft_saved',
      newValue: { status: 'draft' },
    });

    const row = await findMiceRfqWithLeadManager(draft.id);
    res.status(201).json({ miceRfq: await toPublicMiceRfq(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// PATCH /api/mice/rfqs/:id — item 1 "Continue Editing" autosave. Only ever
// succeeds against a row still in 'draft' (model-level WHERE guard) and
// owned by the caller's own agency.
export async function updateDraft(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const current = await findMiceRfqWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'draft') {
      return res.status(400).json({ error: 'not_a_draft', message: 'This request has already been submitted and can no longer be edited here.' });
    }

    const {
      destination, groupSize, eventDateFrom, eventDateTo,
      hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
      hotelIds, tourIds, transferIds, activityIds, itinerary,
    } = req.body;

    await client.query('BEGIN');
    const updated = await updateDraftMiceRfqInfo(client, id, {
      destination, groupSize, eventDateFrom, eventDateTo, hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
    });
    await replaceHotelSelections(client, id, hotelIds);
    await replaceTourSelections(client, id, tourIds);
    await replaceTransferSelections(client, id, transferIds);
    await replaceActivitySelections(client, id, activityIds);
    await replaceItinerary(client, id, itinerary);
    await client.query('COMMIT');

    const row = updated ? await findMiceRfqWithLeadManager(updated.id) : current;
    res.json({ miceRfq: await toPublicMiceRfq(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/mice/rfqs/:id/submit — item 1 "Submit Draft". Re-validated with
// the same strict rules as the direct POST / create() above, enforced by
// createMiceRfqSchema on this route (see routes file).
export async function submit(req, res, next) {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const current = await findMiceRfqWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'draft') {
      return res.status(400).json({ error: 'not_a_draft', message: 'This request has already been submitted.' });
    }

    const {
      destination, groupSize, eventDateFrom, eventDateTo,
      hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
      hotelIds, tourIds, transferIds, activityIds, itinerary,
    } = req.body;

    await client.query('BEGIN');
    await updateDraftMiceRfqInfo(client, id, {
      destination, groupSize, eventDateFrom, eventDateTo, hallCapacityNeeded, seatingStyle, avNeeds, otherRequirements,
    });
    await replaceHotelSelections(client, id, hotelIds);
    await replaceTourSelections(client, id, tourIds);
    await replaceTransferSelections(client, id, transferIds);
    await replaceActivitySelections(client, id, activityIds);
    await replaceItinerary(client, id, itinerary);
    const submitted = await submitDraftMiceRfq(client, id);
    await client.query('COMMIT');

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'mice_rfq',
      entityId: id,
      field: 'submitted',
      oldValue: { status: 'draft' },
      newValue: { status: 'submitted' },
    });

    getIo()?.to('role:ops_admin').emit('queue:new_item', {
      type: 'mice_rfq',
      miceRfqId: id,
      destination: submitted?.destination || current.destination,
    });

    // Task 4, event 1 — MICE Request Submitted (submit-from-draft path).
    await createNotification({
      recipientUserId: req.user.id,
      recipientRole: req.user.role,
      type: 'mice_request_submitted',
      title: 'MICE request submitted',
      message: `Your MICE request for ${submitted?.destination || current.destination} has been submitted successfully.`,
      referenceType: 'mice_rfq',
      referenceId: id,
    });

    const row = await findMiceRfqWithLeadManager(id);
    res.json({ miceRfq: await toPublicMiceRfq(row) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// DELETE /api/mice/rfqs/:id — item 1 "Delete Draft". Scoped to status='draft'
// at the model level, so a submitted/costed/published request can never be
// deleted through this path.
export async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const current = await findMiceRfqWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'draft') {
      return res.status(400).json({ error: 'not_a_draft', message: 'Only drafts can be deleted.' });
    }
    await deleteDraftMiceRfq(id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// GET /api/mice/rfqs/:id — agent's own submission only.
export async function get(req, res, next) {
  try {
    const row = await findMiceRfqWithLeadManager(req.params.id);
    if (!row || row.agency_id !== req.user.agency_id) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ miceRfq: await toPublicMiceRfq(row) });
  } catch (err) {
    next(err);
  }
}

// POST /api/mice/rfqs/:id/respond — item 5: Accept / Request Revision /
// Decline. Only ever fires from 'published' (model-level guard), matching
// "When the proposal status is Published" in the doc.
export async function respond(req, res, next) {
  try {
    const { id } = req.params;
    const { action, comments } = req.body;

    const current = await findMiceRfqWithLeadManager(id);
    if (!current || current.agency_id !== req.user.agency_id) return res.status(404).json({ error: 'not_found' });
    if (current.status !== 'published') {
      return res.status(400).json({ error: 'not_published', message: 'Only a published proposal can be responded to.' });
    }

    const nextStatus = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'revision_requested';
    const updated = await respondToMiceRfq(id, nextStatus);
    if (!updated) return res.status(409).json({ error: 'conflict', message: 'This proposal was just updated — please reload and try again.' });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'mice_rfq',
      entityId: id,
      field: 'agent_response',
      oldValue: { status: current.status },
      newValue: { status: nextStatus, comments: comments || null },
    });

    // Item 7 — lets the (already-implemented) admin MICE Request Management
    // screen pick this up live via the same staff room used for new
    // submissions, without needing its own polling.
    getIo()?.to('role:ops_admin').emit('quote:agent_responded', {
      miceRfqId: id,
      status: nextStatus,
    });

    // Task 4, events 4/5/6 — Revision Requested / Proposal Accepted / Proposal Declined.
    const notif = RESPONSE_NOTIFICATIONS[nextStatus];
    await createNotification({
      recipientUserId: req.user.id,
      recipientRole: req.user.role,
      type: notif.type,
      title: notif.title,
      message: notif.message(current.destination),
      referenceType: 'mice_rfq',
      referenceId: id,
    });

    const row = await findMiceRfqWithLeadManager(id);
    res.json({ miceRfq: await toPublicMiceRfq(row) });
  } catch (err) {
    next(err);
  }
}
