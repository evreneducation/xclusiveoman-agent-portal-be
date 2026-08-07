import {
  listPackageRequestsForAdmin,
  findPackageRequestForAdmin,
  updatePackageRequestLeadManager,
  updatePackageRequestCosting,
  updatePackageRequestItinerary,
  publishPackageRequest,
} from '../models/packageRequestsAdmin.model.js';
// Read helpers reused as-is from the agent-side FIT Package Builder model —
// imported only, never modified, so that module stays untouched.
import {
  listHotelsForRequest,
  listToursForRequest,
  listTransfersForRequest,
  listActivitiesForRequest,
  listTravelersForRequest,
  listItineraryForRequest,
  composeItinerary,
} from '../models/packageRequests.model.js';
import { listStaff, findUserById, toPublicUser } from '../models/users.model.js';
import { insertAuditLog, listAuditLogsForEntity } from '../models/auditLogs.model.js';
import { getIo } from '../sockets/index.js';
import { createNotification } from '../services/notification.service.js';

function toListItem(row) {
  return {
    id: row.id,
    agencyName: row.agency_name,
    agentName: row.agent_full_name,
    agentEmail: row.agent_email,
    destination: row.destination,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    paxAdults: row.pax_adults,
    paxChildren: row.pax_children,
    status: row.status,
    submittedAt: row.created_at,
    leadManager: row.lead_manager_user_id
      ? { id: row.lead_manager_user_id, fullName: row.lead_manager_full_name, email: row.lead_manager_email }
      : null,
  };
}

// Human labels for the "Activity History" timeline (item 7), keyed by the
// `field` an audit_logs row was written against — see saveCosting/publish/
// assignLeadManager below. 'draft_saved'/'submitted'/'agent_response' are
// written by the Agent Quote lifecycle's own controller (packageRequests.
// controller.js) against this same audit_logs table — handled explicitly
// below rather than here since they need more than a flat label (dedupe
// against the synthesized "Submitted"; agent_response's label depends on
// its new_value.status).
const ACTIVITY_LABELS = {
  lead_manager_user_id: 'Lead Manager Assigned',
  net_cost_breakdown: 'Landing Cost Updated',
  markup_rule: 'Markup Updated',
  status: 'Quote Published',
  itinerary: 'Itinerary Updated',
};

function labelForAgentResponse(log) {
  const s = log.new_value?.status;
  if (s === 'accepted') return 'Accepted';
  if (s === 'revision_requested') return 'Revision Requested';
  if (s === 'declined') return 'Declined';
  return 'Agent Responded';
}

// "Submitted" falls back to the request's own created_at/agent when the
// request never went through the draft flow (the original one-shot
// POST /package-requests path never writes a 'submitted' audit_logs row) —
// otherwise the real 'submitted' row (written on draft -> submit) is used so
// a request that spent time as a draft doesn't misreport its draft-creation
// time as its submission time.
async function buildActivityHistory(row) {
  const logs = await listAuditLogsForEntity('package_request', row.id);
  const draftSavedLog = logs.find((l) => l.field === 'draft_saved');
  const submittedLog = logs.find((l) => l.field === 'submitted');

  const timeline = [];
  if (draftSavedLog) {
    timeline.push({ label: 'Draft Saved', at: draftSavedLog.created_at, by: draftSavedLog.actor_full_name || null });
  }
  timeline.push({
    label: 'Submitted',
    at: submittedLog ? submittedLog.created_at : row.created_at,
    by: submittedLog ? submittedLog.actor_full_name || null : row.agent_full_name || null,
  });
  for (const log of logs) {
    if (log.field === 'draft_saved' || log.field === 'submitted') continue; // already placed above
    timeline.push({
      label: log.field === 'agent_response' ? labelForAgentResponse(log) : ACTIVITY_LABELS[log.field] || log.field,
      at: log.created_at,
      by: log.actor_full_name || null,
    });
  }

  return timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
}

function toNumberOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumPrices(items, key) {
  return items.reduce((total, item) => total + toNumberOrZero(item[key]), 0);
}

// Landing Cost Breakdown auto total (item 1): sum of each selected catalog
// item's Product Catalog price. The FIT Package Builder (untouched by this
// task) doesn't capture a nights/qty multiplier per selection, so hotels/
// tours/transfers count one unit per selected item; activities.price_per_pax
// is the one field that's explicitly "per pax", so it's the one component
// multiplied by total pax.
function computeAutoCosting({ hotels, tours, transfers, activities, totalPax }) {
  return {
    hotelCostAuto: sumPrices(hotels, 'price_per_night'),
    tourCostAuto: sumPrices(tours, 'price'),
    transferCostAuto: sumPrices(transfers, 'price'),
    extraCostAuto: sumPrices(activities, 'price_per_pax') * Math.max(totalPax, 1),
  };
}

function round2(n) {
  return Math.round(toNumberOrZero(n) * 100) / 100;
}

function normalizeComponent(c) {
  return {
    auto: c?.auto != null ? Number(c.auto) : 0,
    override: c?.override != null ? Number(c.override) : null,
    total: c?.total != null ? Number(c.total) : 0,
  };
}

// Costing is admin-only (this whole controller), so — unlike the
// agent-facing serializer in packageRequests.controller.js, left untouched —
// catalog item prices are included in the hotels/tours/transfers/activities
// below, to back the Landing Cost Breakdown's per-item display.
async function toDetail(row) {
  const [hotels, tours, transfers, activities, travelers, activityHistory, itinerary] = await Promise.all([
    listHotelsForRequest(row.id),
    listToursForRequest(row.id),
    listTransfersForRequest(row.id),
    listActivitiesForRequest(row.id),
    listTravelersForRequest(row.id),
    buildActivityHistory(row),
    listItineraryForRequest(row.id),
  ]);

  const breakdown = row.net_cost_breakdown || {};
  const markup = row.markup_rule || {};

  return {
    ...toListItem(row),
    hotels: hotels.map((h) => ({
      id: h.id,
      name: h.name,
      city: h.city,
      category: h.category,
      description: h.description,
      images: h.images || [],
      pricePerNight: h.price_per_night != null ? Number(h.price_per_night) : null,
    })),
    tours: tours.map((t) => ({
      id: t.id,
      name: t.name,
      city: t.city,
      category: t.category,
      duration: t.duration,
      description: t.description,
      images: t.images || [],
      price: t.price != null ? Number(t.price) : null,
    })),
    transfers: transfers.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      vehicleClass: t.vehicle_class,
      city: t.city,
      description: t.description,
      price: t.price != null ? Number(t.price) : null,
    })),
    activities: activities.map((a) => ({
      id: a.id,
      name: a.name,
      city: a.city,
      duration: a.duration,
      description: a.description,
      images: a.images || [],
      pricePerPax: a.price_per_pax != null ? Number(a.price_per_pax) : null,
    })),
    travelers: travelers.map((t) => ({
      id: t.id,
      name: t.name,
      passportNo: t.passport_no,
      dob: t.dob,
      roomShareGroup: t.room_share_group,
      isChild: t.is_child,
    })),
    // Day-wise Itinerary Planner (FIT-5) — same composeItinerary the agent
    // serializer uses, against this controller's own (pricier) pools.
    itinerary: composeItinerary(itinerary.days, itinerary.items, { hotel: hotels, tour: tours, transfer: transfers, activity: activities }),
    // Landing Cost Breakdown + Markup Panel + Quote Summary (items 1/3/4).
    costing: {
      hotels: normalizeComponent(breakdown.hotels),
      tours: normalizeComponent(breakdown.tours),
      transfers: normalizeComponent(breakdown.transfers),
      extras: normalizeComponent(breakdown.extras),
    },
    landingCost: breakdown.landingCost != null ? Number(breakdown.landingCost) : null,
    markupType: markup.type || null,
    markupValue: markup.value != null ? Number(markup.value) : null,
    sellPrice: row.sell_price != null ? Number(row.sell_price) : null,
    // Internal Notes (item 5) — admin-only by construction: this whole
    // controller/serializer is never reachable from the agent-facing routes.
    internalNotes: row.internal_notes || '',
    publishedAt: row.published_at,
    publishedBy: row.published_by_user_id
      ? { id: row.published_by_user_id, fullName: row.published_by_full_name }
      : null,
    activityHistory,
  };
}

// GET /api/admin/package-requests?status=&destination=&search=&submittedFrom=&submittedTo=&page=&pageSize=
export async function list(req, res, next) {
  try {
    const { status, destination, search, submittedFrom, submittedTo, page, pageSize } = req.query;
    const { rows, total, page: currentPage, pageSize: limit } = await listPackageRequestsForAdmin({
      status, destination, search, submittedFrom, submittedTo, page, pageSize,
    });

    res.json({
      packageRequests: rows.map(toListItem),
      pagination: {
        total,
        page: currentPage,
        pageSize: limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/package-requests/:id
export async function get(req, res, next) {
  try {
    const row = await findPackageRequestForAdmin(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ packageRequest: await toDetail(row) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/package-requests/lead-manager-candidates
// Assignable staff pool for the "Assign Lead Manager" control (REL-3). Reuses
// the general staff listing rather than the super-admin-only RM/Sales
// Manager management endpoints, so any staff member with Quote Inbox access
// can actually populate this dropdown.
export async function listLeadManagerCandidates(req, res, next) {
  try {
    const staff = await listStaff();
    res.json({ staff: staff.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/package-requests/:id/lead-manager — FIT-8/REL-3. Also
// advances status submitted -> assigned (and back on unassign) per this
// task's requirement; leaves status untouched once costing has begun.
export async function assignLeadManager(req, res, next) {
  try {
    const { id } = req.params;
    const { leadManagerUserId } = req.body;

    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });

    if (leadManagerUserId) {
      const candidate = await findUserById(leadManagerUserId);
      if (!candidate || candidate.agency_id !== null) {
        return res.status(400).json({ error: 'invalid_lead_manager', message: 'Not a valid staff member' });
      }
    }

    let nextStatus = current.status;
    if (leadManagerUserId && current.status === 'submitted') nextStatus = 'assigned';
    if (!leadManagerUserId && current.status === 'assigned') nextStatus = 'submitted';

    await updatePackageRequestLeadManager(id, leadManagerUserId || null, nextStatus);

    if (leadManagerUserId) {
      // doc §13: lead:assigned -> staff (assigned user).
      getIo()?.to(`user:${leadManagerUserId}`).emit('lead:assigned', {
        packageRequestId: id,
        destination: current.destination,
      });
      // Agent Quote lifecycle (item 7) — same event/room the agent's "My FIT
      // Requests" list already listens on, so status updates live instantly
      // instead of on next page load.
      getIo()?.to(`agency:${current.agency_id}`).emit('quote:status_changed', {
        packageRequestId: id,
        status: nextStatus,
      });
      // Activity History (item 7) — only logged on an actual assignment,
      // matching the doc's example timeline entry ("Lead Manager Assigned").
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'package_request',
        entityId: id,
        field: 'lead_manager_user_id',
        oldValue: { leadManagerUserId: current.lead_manager_user_id },
        newValue: { leadManagerUserId },
      });

      // Task 3, event 2 — Lead Manager Assigned. `candidate` above is scoped
      // to the earlier validation block, so it's re-fetched here rather than
      // widening that block's scope.
      const leadManager = await findUserById(leadManagerUserId);
      await createNotification({
        recipientUserId: current.created_by_user_id,
        type: 'fit_lead_manager_assigned',
        title: 'Lead Manager assigned',
        message: `${leadManager?.full_name || 'A Lead Manager'} has been assigned as your Lead Manager for the FIT request to ${current.destination}.`,
        referenceType: 'package_request',
        referenceId: id,
      });
    }

    const updatedRow = await findPackageRequestForAdmin(id);
    res.json({ packageRequest: await toDetail(updatedRow) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/package-requests/:id/costing — items 1/2/3/5 ("Save
// Draft"). Always saves whatever the form currently holds — Publish (below)
// is a separate, validated step, so a failed publish attempt never discards
// costing/markup/notes edits.
export async function saveCosting(req, res, next) {
  try {
    const { id } = req.params;
    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });

    const [hotels, tours, transfers, activities] = await Promise.all([
      listHotelsForRequest(id),
      listToursForRequest(id),
      listTransfersForRequest(id),
      listActivitiesForRequest(id),
    ]);
    const totalPax = (current.pax_adults || 0) + (current.pax_children || 0);
    const auto = computeAutoCosting({ hotels, tours, transfers, activities, totalPax });

    const { hotelCost, tourCost, transferCost, extraCost, markupType, markupValue, internalNotes } = req.body;

    const hotelTotal = hotelCost ?? auto.hotelCostAuto;
    const tourTotal = tourCost ?? auto.tourCostAuto;
    const transferTotal = transferCost ?? auto.transferCostAuto;
    const extraTotal = extraCost ?? auto.extraCostAuto;
    const landingCost = round2(hotelTotal + tourTotal + transferTotal + extraTotal);

    const sellPrice = round2(
      markupType === 'percentage' ? landingCost + (landingCost * markupValue) / 100 : landingCost + markupValue
    );

    const netCostBreakdown = {
      hotels: { auto: round2(auto.hotelCostAuto), override: hotelCost, total: round2(hotelTotal) },
      tours: { auto: round2(auto.tourCostAuto), override: tourCost, total: round2(tourTotal) },
      transfers: { auto: round2(auto.transferCostAuto), override: transferCost, total: round2(transferTotal) },
      extras: { auto: round2(auto.extraCostAuto), override: extraCost, total: round2(extraTotal) },
      landingCost,
    };
    const markupRule = { type: markupType, value: markupValue };

    // Never regress a quote that's already moved past costing (published,
    // accepted, etc.) back down to 'costed' just because the admin resaved.
    const nextStatus = ['submitted', 'assigned', 'costed'].includes(current.status) ? 'costed' : current.status;

    const updated = await updatePackageRequestCosting(id, {
      netCostBreakdown, markupRule, sellPrice, internalNotes, status: nextStatus,
    });

    // Activity History (item 7) — only when the figure actually changed, so
    // resaving identical numbers doesn't spam the timeline.
    const prevBreakdown = current.net_cost_breakdown || {};
    if (prevBreakdown.landingCost !== netCostBreakdown.landingCost) {
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'package_request',
        entityId: id,
        field: 'net_cost_breakdown',
        oldValue: prevBreakdown,
        newValue: netCostBreakdown,
      });
    }
    const prevMarkup = current.markup_rule || {};
    if (prevMarkup.type !== markupRule.type || toNumberOrZero(prevMarkup.value) !== toNumberOrZero(markupRule.value)) {
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'package_request',
        entityId: id,
        field: 'markup_rule',
        oldValue: prevMarkup,
        newValue: markupRule,
      });
    }

    res.json({ packageRequest: await toDetail(updated) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/package-requests/:id/itinerary — Day-wise Itinerary
// Planner (FIT-5): lets the admin rearrange/edit the agent's day-by-day plan
// before or after publishing. Always saves whatever the editor currently
// holds (same "always send full state" contract as saveCosting above) —
// there's no separate validate-then-publish step for the itinerary itself.
export async function saveItinerary(req, res, next) {
  try {
    const { id } = req.params;
    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });

    await updatePackageRequestItinerary(id, req.body.days);

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'package_request',
      entityId: id,
      field: 'itinerary',
      newValue: { dayCount: req.body.days.length },
    });

    const updated = await findPackageRequestForAdmin(id);
    res.json({ packageRequest: await toDetail(updated) });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/package-requests/:id/publish — items 6/9. Validates
// against whatever's already been saved via saveCosting above (no body) —
// the FE calls PATCH .../costing immediately before this so the admin's
// latest edits are persisted either way, pass or fail.
export async function publish(req, res, next) {
  try {
    const { id } = req.params;
    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });

    const errors = [];
    if (!current.lead_manager_user_id) errors.push('Assign a Lead Manager before publishing.');
    const landingCost = Number(current.net_cost_breakdown?.landingCost);
    if (!(landingCost > 0)) errors.push('Save a landing cost before publishing.');
    const sellPrice = Number(current.sell_price);
    if (!(sellPrice > 0)) errors.push('Final selling price is invalid — check the markup.');

    if (errors.length) {
      return res.status(400).json({ error: 'validation_error', message: errors.join(' ') });
    }

    const updated = await publishPackageRequest(id, req.user.id);

    // Agent Quote lifecycle (item 7): Publish Quote, and — when this fires a
    // second time after a Revision Requested cycle — the admin's response to
    // that revision, both covered by the same event.
    getIo()?.to(`agency:${current.agency_id}`).emit('quote:status_changed', {
      packageRequestId: id,
      status: 'published',
    });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'package_request',
      entityId: id,
      field: 'status',
      oldValue: { status: current.status },
      newValue: { status: 'published' },
    });

    // Task 3, event 3 — Quote Published.
    await createNotification({
      recipientUserId: current.created_by_user_id,
      type: 'fit_quote_published',
      title: 'Your Custom FIT quote is ready',
      message: `Your Custom FIT quote for ${current.destination} has been published and is ready for review.`,
      referenceType: 'package_request',
      referenceId: id,
    });

    res.json({ packageRequest: await toDetail(updated) });
  } catch (err) {
    next(err);
  }
}
