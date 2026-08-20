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
import { listStaffByRole, findUserById, toPublicUser } from '../models/users.model.js';
import { listAgenciesByRmIds } from '../models/agencies.model.js';
import { roomsForOccupancy } from '../utils/occupancy.js';
import { computeMealsCost } from '../utils/meals.js';
import { mealsModel, visaModel } from '../models/catalog.model.js';
import { insertAuditLog, listAuditLogsForEntity } from '../models/auditLogs.model.js';
import { getIo } from '../sockets/index.js';
import { createNotification } from '../services/notification.service.js';
import { applyLeadManagerAssignment } from '../services/leadManagerAssignment.service.js';

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

// Occupancy-tiered pricing (0061_hotel_occupancy_pricing.sql) — each
// hotel-day already picks a Single/Double/Triple occupancy
// (0046_package_request_itinerary_items_occupancy.sql; the headcount itself
// is the trip's own pax_adults, fixed for the whole request), but until now
// that choice only decided *room count*, not price — every occupancy was
// costed at the same flat price_per_night. This now reads the hotel's own
// price for the specific tier chosen (single_price/double_price/triple_price)
// instead — a hotel that doesn't offer the chosen tier contributes nothing
// for that placement (checked directly, not silently substituted from a
// different tier, since this feeds a real client-facing quote). Still sums
// tierPrice × rooms per itinerary-day placement (rooms = ceil(pax_adults /
// occupancy capacity) — see roomsForOccupancy) — a hotel used on 3 days
// counts 3 times, same as FD Packages' computeNetRatePerPax, rather than
// once per distinct selected hotel. Tours/transfers/extras still count once
// per selected item, not per itinerary occurrence — untouched, unlike hotels.
const OCCUPANCY_PRICE_FIELD = { single: 'single_price', double: 'double_price', triple: 'triple_price' };

function computeHotelCostAuto(itineraryItems, hotels, totalAdults) {
  return (itineraryItems || []).reduce((total, it) => {
    if (it.item_type !== 'hotel') return total;
    const hotel = hotels.find((h) => h.id === it.item_id);
    if (!hotel) return total;
    const field = OCCUPANCY_PRICE_FIELD[it.occupancy] || OCCUPANCY_PRICE_FIELD.double;
    const tierPrice = hotel[field];
    if (tierPrice == null) return total; // this hotel doesn't offer the chosen occupancy
    return total + Number(tierPrice) * roomsForOccupancy(totalAdults, it.occupancy);
  }, 0);
}

// Visa add-on flat total: visa_people × the Product Catalog's one Visa row
// (price_per_person — see visaModel/0051_visa_catalog.sql). Only counts once
// the agent has actually checked the Visa box and a headcount is set — a
// stray visa_people with visa_enabled false (or vice versa) contributes
// nothing, same "all pieces required" gate computeMealsCost uses per meal type.
function computeVisaCostAuto(row, visaCatalog) {
  if (!row.visa_enabled || !row.visa_people) return 0;
  const visa = (visaCatalog || [])[0];
  return visa ? Number(visa.price_per_person || 0) * Number(row.visa_people) : 0;
}

// Landing Cost Breakdown auto total (item 1): sum of each selected catalog
// item's Product Catalog price. Tours/transfers still count one unit per
// selected item (no nights/qty multiplier there); activities.price_per_pax
// is the one field that's explicitly "per pax", so it's the one component
// multiplied by total pax. Hotels are the exception — see
// computeHotelCostAuto above. Meals is a flat add-on total (headcount ×
// days) via computeMealsCost, shared with FD Packages (src/utils/meals.js) —
// `packageRequestRow` is the raw package_requests row (lunch/dinner
// selection, and pax_adults for hotel occupancy, both live directly on it,
// not in the itinerary). Visa is a similar flat add-on total, see
// computeVisaCostAuto above.
function computeAutoCosting({ hotels, tours, transfers, activities, totalPax, itineraryItems, packageRequestRow, mealsCatalog, visaCatalog }) {
  return {
    hotelCostAuto: computeHotelCostAuto(itineraryItems, hotels, packageRequestRow.pax_adults),
    tourCostAuto: sumPrices(tours, 'price'),
    transferCostAuto: sumPrices(transfers, 'price'),
    extraCostAuto: sumPrices(activities, 'price_per_pax') * Math.max(totalPax, 1),
    mealsCostAuto: computeMealsCost(packageRequestRow, mealsCatalog),
    visaCostAuto: computeVisaCostAuto(packageRequestRow, visaCatalog),
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
  const [hotels, tours, transfers, activities, travelers, activityHistory, itinerary, mealsCatalog, visaCatalog] = await Promise.all([
    listHotelsForRequest(row.id),
    listToursForRequest(row.id),
    listTransfersForRequest(row.id),
    listActivitiesForRequest(row.id),
    listTravelersForRequest(row.id),
    buildActivityHistory(row),
    listItineraryForRequest(row.id),
    mealsModel.list(),
    visaModel.list(),
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
      // Occupancy-tiered pricing (0061_hotel_occupancy_pricing.sql) — lets
      // the itinerary builder's occupancy picker (QuoteInboxDetail.jsx) know
      // which of single/double/triple this hotel actually offers, rather
      // than blindly costing every choice at the same flat pricePerNight.
      singlePrice: h.single_price != null ? Number(h.single_price) : null,
      doublePrice: h.double_price != null ? Number(h.double_price) : null,
      triplePrice: h.triple_price != null ? Number(h.triple_price) : null,
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
    itinerary: composeItinerary(
      itinerary.days, itinerary.items,
      { hotel: hotels, tour: tours, transfer: transfers, activity: activities },
      row.pax_adults
    ),
    // Landing Cost Breakdown + Markup Panel + Quote Summary (items 1/3/4).
    costing: {
      hotels: normalizeComponent(breakdown.hotels),
      tours: normalizeComponent(breakdown.tours),
      transfers: normalizeComponent(breakdown.transfers),
      extras: normalizeComponent(breakdown.extras),
      meals: normalizeComponent(breakdown.meals),
      visa: normalizeComponent(breakdown.visa),
    },
    // Freshly computed (not the persisted breakdown.meals.auto snapshot from
    // the last save) — unlike hotels/tours/etc., nothing on the admin's Quote
    // Inbox page can change lunch/dinner people/days live, so there's no
    // client-side mirror of this formula the way computeHotelAuto exists for
    // hotels; the frontend just reads this value directly.
    mealsCostAuto: computeMealsCost(row, mealsCatalog),
    // Same reasoning as mealsCostAuto above — the agent's Visa headcount is
    // fixed once submitted, nothing here changes it live.
    visaCostAuto: computeVisaCostAuto(row, visaCatalog),
    // Raw meal selection — same fields the agent-facing serializer exposes
    // (packageRequests.controller.js) — so the Inclusions auto-seed below can
    // tell "meals were actually selected" apart from "priced at ₹0" (which
    // mealsCostAuto alone can't: a ₹0 catalog rate would compute to 0 either way).
    lunchMealId: row.lunch_meal_id,
    lunchPeople: row.lunch_people,
    lunchDays: row.lunch_days,
    dinnerMealId: row.dinner_meal_id,
    dinnerPeople: row.dinner_people,
    dinnerDays: row.dinner_days,
    // Raw Visa selection — same reason as the meal fields above, and the
    // same field the Inclusions auto-seed reads to add "Visa" (see
    // admin/pages/QuoteInboxDetail.jsx).
    visaEnabled: row.visa_enabled,
    visaPeople: row.visa_people,
    landingCost: breakdown.landingCost != null ? Number(breakdown.landingCost) : null,
    markupType: markup.type || null,
    markupValue: markup.value != null ? Number(markup.value) : null,
    sellPrice: row.sell_price != null ? Number(row.sell_price) : null,
    // Internal Notes (item 5) — admin-only by construction: this whole
    // controller/serializer is never reachable from the agent-facing routes.
    internalNotes: row.internal_notes || '',
    // Inclusions/Exclusions — admin-authored free text set alongside costing;
    // unlike internalNotes, this is client-facing (shown read-only on the
    // agent's own quote view once published — packageRequests.controller.js),
    // so the admin can see/edit it here at any point, not just post-publish.
    inclusions: row.inclusions || '',
    exclusions: row.exclusions || '',
    publishedAt: row.published_at,
    publishedBy: row.published_by_user_id
      ? { id: row.published_by_user_id, fullName: row.published_by_full_name }
      : null,
    activityHistory,
  };
}

// GET /api/admin/package-requests?status=&destination=&search=&submittedFrom=&submittedTo=&page=&pageSize=
// Team Portal Quotes & Pricing scoping — an LM (sales_manager) only ever
// sees the requests actually assigned to them (pr.lead_manager_user_id,
// same pool leadManagerAssignment.service.js draws from and REL-3's manual
// (re)assignment writes to); an RM only ever sees their own agencies' — same
// "by his record" posture as Approved Agents/Bookings & Docs. Neither
// applies to any other STAFF_ROLE, who keep seeing the full inbox exactly
// as before.
async function quotesPricingScope(req) {
  if (req.user.role === 'sales_manager') {
    return { leadManagerUserId: req.user.id };
  }
  if (req.user.role === 'relationship_manager') {
    const own = await listAgenciesByRmIds([req.user.id]);
    return { agencyIds: own.map((a) => a.id) };
  }
  return {};
}

export async function list(req, res, next) {
  try {
    const { status, destination, search, submittedFrom, submittedTo, page, pageSize } = req.query;
    const scope = await quotesPricingScope(req);
    if (scope.agencyIds?.length === 0) {
      return res.json({ packageRequests: [], pagination: { total: 0, page: 1, pageSize: Number(pageSize) || 20, totalPages: 1 } });
    }
    const { rows, total, page: currentPage, pageSize: limit } = await listPackageRequestsForAdmin({
      status, destination, search, submittedFrom, submittedTo, page, pageSize, ...scope,
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

// Applied to every :id-scoped package-request route below (get, lead
// manager assignment, costing, itinerary, publish) — an LM may only ever
// touch a request already assigned to them, an RM only one raised by one of
// their own agencies; every other STAFF_ROLE is untouched. 404, not 403 —
// same "don't reveal existence" posture bookingsAdmin.routes.js's
// scopeToOwnAgencyBooking already uses.
async function assertQuotesPricingAccess(req, row) {
  if (req.user.role === 'sales_manager') {
    return row.lead_manager_user_id === req.user.id;
  }
  if (req.user.role === 'relationship_manager') {
    const own = await listAgenciesByRmIds([req.user.id]);
    return own.some((a) => a.id === row.agency_id);
  }
  return true;
}

// GET /api/admin/package-requests/:id
export async function get(req, res, next) {
  try {
    const row = await findPackageRequestForAdmin(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, row))) return res.status(404).json({ error: 'not_found' });
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
// Lead Manager candidates are Sales Managers only, per policy — same pool
// leadManagerAssignment.service.js's round-robin draws from, so a manual
// (re)assignment here can never diverge from what auto-assignment would
// have picked.
export async function listLeadManagerCandidates(req, res, next) {
  try {
    const staff = await listStaffByRole('sales_manager');
    res.json({ staff: staff.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// Quotes & Pricing is read-only for a Relationship Manager (their Access
// Feature is oversight of their own agencies' quotes, not pricing/publishing
// them — that stays a Lead Manager/ops_admin+ job). Applied to every write
// endpoint below; the read endpoints (list/get) stay governed by
// assertQuotesPricingAccess/quotesPricingScope above instead, which do let
// an RM view.
function blockReadOnlyRole(req, res) {
  if (req.user.role === 'relationship_manager') {
    res.status(403).json({ error: 'forbidden', message: 'Quotes & Pricing is view-only on your account.' });
    return true;
  }
  return false;
}

// PATCH /api/admin/package-requests/:id/lead-manager — FIT-8/REL-3. Also
// advances status submitted -> assigned (and back on unassign) per this
// task's requirement; leaves status untouched once costing has begun.
export async function assignLeadManager(req, res, next) {
  try {
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const { leadManagerUserId } = req.body;

    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });

    if (leadManagerUserId) {
      // Only ever a Sales Manager, per policy — same restriction the
      // round-robin (leadManagerAssignment.service.js) enforces automatically,
      // now also enforced on a manual (re)assignment.
      const candidate = await findUserById(leadManagerUserId);
      if (!candidate || candidate.role !== 'sales_manager') {
        return res.status(400).json({ error: 'invalid_lead_manager', message: 'Lead Manager must be a Sales Manager' });
      }
    }

    let nextStatus = current.status;
    if (leadManagerUserId && current.status === 'submitted') nextStatus = 'assigned';
    if (!leadManagerUserId && current.status === 'assigned') nextStatus = 'submitted';

    if (leadManagerUserId) {
      // Same write + side effects (socket emits, Activity History, agent
      // notification) the round-robin auto-assignment fires — see
      // leadManagerAssignment.service.js.
      await applyLeadManagerAssignment({
        packageRequestId: id,
        leadManagerUserId,
        previousLeadManagerUserId: current.lead_manager_user_id,
        nextStatus,
        actorUserId: req.user.id,
        destination: current.destination,
        agencyId: current.agency_id,
        createdByUserId: current.created_by_user_id,
      });
    } else {
      // Unassign — no candidate to validate, no "assigned" notification to send.
      await updatePackageRequestLeadManager(id, null, nextStatus);
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
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, current))) return res.status(404).json({ error: 'not_found' });

    const [hotels, tours, transfers, activities, itinerary, mealsCatalog, visaCatalog] = await Promise.all([
      listHotelsForRequest(id),
      listToursForRequest(id),
      listTransfersForRequest(id),
      listActivitiesForRequest(id),
      listItineraryForRequest(id),
      mealsModel.list(),
      visaModel.list(),
    ]);
    const totalPax = (current.pax_adults || 0) + (current.pax_children || 0);
    const auto = computeAutoCosting({
      hotels, tours, transfers, activities, totalPax,
      itineraryItems: itinerary.items, packageRequestRow: current, mealsCatalog, visaCatalog,
    });

    const {
      hotelCost, tourCost, transferCost, extraCost, mealCost, visaCost,
      markupType, markupValue, internalNotes, inclusions, exclusions,
    } = req.body;

    const hotelTotal = hotelCost ?? auto.hotelCostAuto;
    const tourTotal = tourCost ?? auto.tourCostAuto;
    const transferTotal = transferCost ?? auto.transferCostAuto;
    const extraTotal = extraCost ?? auto.extraCostAuto;
    const mealTotal = mealCost ?? auto.mealsCostAuto;
    const visaTotal = visaCost ?? auto.visaCostAuto;
    const landingCost = round2(hotelTotal + tourTotal + transferTotal + extraTotal + mealTotal + visaTotal);

    const sellPrice = round2(
      markupType === 'percentage' ? landingCost + (landingCost * markupValue) / 100 : landingCost + markupValue
    );

    const netCostBreakdown = {
      hotels: { auto: round2(auto.hotelCostAuto), override: hotelCost, total: round2(hotelTotal) },
      tours: { auto: round2(auto.tourCostAuto), override: tourCost, total: round2(tourTotal) },
      transfers: { auto: round2(auto.transferCostAuto), override: transferCost, total: round2(transferTotal) },
      extras: { auto: round2(auto.extraCostAuto), override: extraCost, total: round2(extraTotal) },
      meals: { auto: round2(auto.mealsCostAuto), override: mealCost, total: round2(mealTotal) },
      visa: { auto: round2(auto.visaCostAuto), override: visaCost, total: round2(visaTotal) },
      landingCost,
    };
    const markupRule = { type: markupType, value: markupValue };

    // Never regress a quote that's already moved past costing (published,
    // accepted, etc.) back down to 'costed' just because the admin resaved.
    const nextStatus = ['submitted', 'assigned', 'costed'].includes(current.status) ? 'costed' : current.status;

    const updated = await updatePackageRequestCosting(id, {
      netCostBreakdown, markupRule, sellPrice, internalNotes, inclusions, exclusions, status: nextStatus,
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
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, current))) return res.status(404).json({ error: 'not_found' });

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
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const current = await findPackageRequestForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, current))) return res.status(404).json({ error: 'not_found' });

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
