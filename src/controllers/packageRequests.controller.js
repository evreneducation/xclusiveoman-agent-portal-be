import { pool } from '../db/pool.js';
import { getIo } from '../sockets/index.js';
import { generateItineraryPdf } from '../services/itineraryPdf.service.js';
import { createBookingFromPackageRequest } from '../services/booking.service.js';
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
  listItineraryForRequest,
  replaceItinerary,
  composeItinerary,
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
import { findUserById } from '../models/users.model.js';
import { pickNextRoundRobinLeadManager, applyLeadManagerAssignment } from '../services/leadManagerAssignment.service.js';

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
  const [hotels, tours, transfers, activities, travelers, activityHistory, itinerary] = await Promise.all([
    listHotelsForRequest(row.id),
    listToursForRequest(row.id),
    listTransfersForRequest(row.id),
    listActivitiesForRequest(row.id),
    listTravelersForRequest(row.id),
    buildAgentActivityHistory(row),
    listItineraryForRequest(row.id),
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
    // Raw meal selection, so "Continue Editing" can prefill the Meals
    // section (PackageBuilder.jsx) — no price ever included here, same as
    // everywhere else in this agent-facing serializer.
    lunchMealId: row.lunch_meal_id,
    lunchPeople: row.lunch_people,
    lunchDays: row.lunch_days,
    dinnerMealId: row.dinner_meal_id,
    dinnerPeople: row.dinner_people,
    dinnerDays: row.dinner_days,
    // Raw Visa selection — same reason as the meal fields above (prefills
    // the Package Builder's Visa checkbox/headcount on "Continue Editing").
    visaEnabled: row.visa_enabled,
    visaPeople: row.visa_people,
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
    // Day-wise Itinerary Planner (FIT-5) — enriched against the same
    // hotels/tours/transfers/activities pools above, so an item resolves to
    // its name/city even though only its type+id persist.
    itinerary: composeItinerary(
      itinerary.days, itinerary.items,
      { hotel: hotels, tour: tours, transfer: transfers, activity: activities },
      row.pax_adults
    ),
    // Inclusions/Exclusions (see 0048_package_request_inclusions_exclusions.sql)
    // — admin-authored free text, set alongside costing when preparing the
    // quotation (packageRequestsAdmin.controller.js's saveCosting). Read-only
    // here, and only once the quote has actually been published — same
    // gating as sellPrice below (FIT-10: the agent sees the finished
    // quotation, not admin's in-progress costing draft).
    inclusions: isPublishedOrLater ? row.inclusions || '' : null,
    exclusions: isPublishedOrLater ? row.exclusions || '' : null,
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

// Every request that lands in the admin queue gets a Lead Manager
// automatically, round-robin across active Sales Managers only (see
// leadManagerAssignment.service.js) — the admin never has to pick one by
// hand, and a request is never left unassigned once it's submitted. Called
// right after the create/submit transaction commits, on the still-'submitted'
// row it just wrote. Best-effort: a hiccup here (e.g. no active Sales
// Managers yet) must never fail the agent's already-successful submission —
// the request simply stays 'submitted' and can still be assigned manually.
async function autoAssignLeadManager(row) {
  try {
    const leadManagerUserId = await pickNextRoundRobinLeadManager();
    if (!leadManagerUserId) return; // no active Sales Manager to assign to yet
    await applyLeadManagerAssignment({
      packageRequestId: row.id,
      leadManagerUserId,
      previousLeadManagerUserId: null,
      nextStatus: 'assigned',
      actorUserId: null, // automatic — no admin actor
      destination: row.destination,
      agencyId: row.agency_id,
      createdByUserId: row.created_by_user_id,
    });
  } catch (err) {
    console.error('Round-robin Lead Manager assignment failed for package request', row.id, err);
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
      hotelIds, tourIds, transferIds, activityIds, travelers, itinerary,
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
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
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
    });

    await addHotelSelections(client, packageRequest.id, hotelIds);
    await addTourSelections(client, packageRequest.id, tourIds);
    await addTransferSelections(client, packageRequest.id, transferIds);
    await addActivitySelections(client, packageRequest.id, activityIds);
    await addTravelers(client, packageRequest.id, travelers);
    await replaceItinerary(client, packageRequest.id, itinerary);

    await client.query('COMMIT');

    // Auto-assign a Lead Manager (round-robin, Sales Managers only) before
    // the admin queue even sees this — see autoAssignLeadManager above.
    await autoAssignLeadManager(packageRequest);

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
    const {
      destination, dateFrom, dateTo, paxAdults, paxChildren, hotelIds, tourIds, transferIds, activityIds, travelers, itinerary,
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
    } = req.body;

    await client.query('BEGIN');
    const draft = await createDraftPackageRequest(client, {
      agencyId: req.user.agency_id,
      createdByUserId: req.user.id,
      destination, dateFrom, dateTo, paxAdults, paxChildren,
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
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
    await replaceItinerary(client, draft.id, itinerary);
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

    const {
      destination, dateFrom, dateTo, paxAdults, paxChildren, hotelIds, tourIds, transferIds, activityIds, travelers, itinerary,
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
    } = req.body;

    await client.query('BEGIN');
    const updated = await updateDraftTripInfo(client, id, {
      destination, dateFrom, dateTo, paxAdults, paxChildren,
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
    });
    await replaceHotelSelections(client, id, hotelIds);
    await replaceTourSelections(client, id, tourIds);
    await replaceTransferSelections(client, id, transferIds);
    await replaceActivitySelections(client, id, activityIds);
    await replaceTravelers(client, id, travelers); // unfiltered — see createDraft's comment above
    await replaceItinerary(client, id, itinerary);
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

    const {
      destination, dateFrom, dateTo, paxAdults, paxChildren, hotelIds, tourIds, transferIds, activityIds, travelers, itinerary,
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
    } = req.body;

    await client.query('BEGIN');
    await updateDraftTripInfo(client, id, {
      destination, dateFrom, dateTo, paxAdults, paxChildren,
      lunchMealId, lunchPeople, lunchDays, dinnerMealId, dinnerPeople, dinnerDays, visaEnabled, visaPeople,
    });
    await replaceHotelSelections(client, id, hotelIds);
    await replaceTourSelections(client, id, tourIds);
    await replaceTransferSelections(client, id, transferIds);
    await replaceActivitySelections(client, id, activityIds);
    await replaceTravelers(client, id, travelers);
    await replaceItinerary(client, id, itinerary);
    const submitted = await submitDraftPackageRequest(client, id);
    await client.query('COMMIT');

    // Auto-assign a Lead Manager (round-robin, Sales Managers only) — same
    // as the direct-submit path in create() above.
    if (submitted) await autoAssignLeadManager(submitted);

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

// GET /api/package-requests/:id/itinerary.pdf — server-side PDF export of
// the same "Detailed Itinerary" document the Review & Submit step's
// ItineraryDocument.jsx renders on screen (see itineraryPdf.service.js for
// why this replaced the old window.print() flow). Sits behind this router's
// normal requireAuth/requireRole (packageRequests.routes.js) — same
// ownership check as get() above — the short-lived pdfToken the Puppeteer
// render itself authenticates with is minted here, after that check passes,
// never accepted from the client.
export async function downloadItineraryPdf(req, res, next) {
  try {
    const { id } = req.params;
    const row = await findPackageRequestWithLeadManager(id);
    if (!row || row.agency_id !== req.user.agency_id) {
      return res.status(404).json({ error: 'not_found' });
    }

    let pdfBuffer;
    try {
      pdfBuffer = await generateItineraryPdf({ packageRequestId: id, userId: req.user.id });
    } catch (err) {
      // Distinguish "we couldn't render it" from a generic 500 — the agent
      // sees a clear "try again" message instead of a bare server error.
      err.status = 502;
      err.publicMessage = 'Unable to generate the itinerary PDF right now. Please try again.';
      throw err;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="itinerary-${id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    if (err.status && err.publicMessage) {
      return res.status(err.status).json({ error: 'pdf_generation_failed', message: err.publicMessage });
    }
    next(err);
  }
}

// GET /api/itinerary-pdf/:id/data — not mounted on this router (see
// routes/itineraryPdfData.routes.js): sits behind requirePdfToken instead of
// requireAuth, since this is the endpoint the Puppeteer-rendered print page
// itself calls (agent/pages/ItineraryPrint.jsx), a browser context with no
// login session/cookies. Returns the exact same shape as get() above so
// ItineraryPrint.jsx can build the same ItineraryDocument props
// PackageBuilder.jsx's Review step does, just reached a different way.
//
// req.pdfClaims (set by requirePdfToken) already scopes the token to one
// packageRequestId + one userId — both re-checked against fresh DB state
// here rather than trusted as-is, same posture requireAuth takes toward a
// normal access token's claims.
export async function getItineraryDataForPdf(req, res, next) {
  try {
    const { id } = req.params;
    if (req.pdfClaims.packageRequestId !== id) {
      return res.status(403).json({ error: 'forbidden', message: 'This token is not valid for this itinerary' });
    }

    const [row, user] = await Promise.all([
      findPackageRequestWithLeadManager(id),
      findUserById(req.pdfClaims.sub),
    ]);
    if (!row || !user || row.agency_id !== user.agency_id) {
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

    // FIT-13: an accepted quote converts to a booking — creates the
    // bookings row this quote never got one before (see
    // booking.service.js#createBookingFromPackageRequest for the
    // check-first-then-create idempotency). Best-effort: a hiccup here must
    // never undo the agent's already-committed acceptance above — worst
    // case the booking is simply missing until this is retried/fixed, same
    // posture as this file's own autoAssignLeadManager.
    if (nextStatus === 'accepted') {
      try {
        await createBookingFromPackageRequest(updated);
      } catch (err) {
        console.error('Failed to create booking for accepted package request', id, err);
      }
    }

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
