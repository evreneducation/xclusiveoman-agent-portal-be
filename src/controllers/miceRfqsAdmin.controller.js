import {
  listMiceRfqsForAdmin,
  findMiceRfqForAdmin,
  updateMiceRfqLeadManager,
  updateMiceRfqCosting,
  updateMiceRfqItinerary,
  publishMiceRfq,
} from '../models/miceRfqsAdmin.model.js';
// Read helpers reused as-is from the agent-side MICE curation model —
// imported only, never modified, so that module stays untouched.
import {
  listHotelsForRfq,
  listToursForRfq,
  listTransfersForRfq,
  listActivitiesForRfq,
  listItineraryForRfq,
  composeItinerary,
} from '../models/miceRfqs.model.js';
import { listStaff, findUserById, toPublicUser } from '../models/users.model.js';
import { listAgenciesByRmIds } from '../models/agencies.model.js';
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
    groupSize: row.group_size,
    eventDateFrom: row.event_date_from,
    eventDateTo: row.event_date_to,
    status: row.status,
    submittedAt: row.created_at,
    leadManager: row.lead_manager_user_id
      ? { id: row.lead_manager_user_id, fullName: row.lead_manager_full_name, email: row.lead_manager_email }
      : null,
  };
}

// Activity Timeline (item 8) — reuses the same generic audit_logs table the
// Custom FIT Quote Details' Activity History already writes to, scoped to
// entity='mice_rfq'. "Request Submitted" isn't an audit_logs row — MICE has
// no draft flow (out of scope), so created_at always is the submission time.
const ACTIVITY_LABELS = {
  lead_manager_user_id: 'Lead Manager Assigned',
  cost_breakdown: 'Cost Updated',
  markup_rule: 'Markup Updated',
  status: 'Proposal Published',
  itinerary: 'Itinerary Updated',
};

async function buildActivityHistory(row) {
  const logs = await listAuditLogsForEntity('mice_rfq', row.id);
  const timeline = [
    { label: 'Request Submitted', at: row.created_at, by: row.agent_full_name || null },
    ...logs.map((log) => ({
      label: ACTIVITY_LABELS[log.field] || log.field,
      at: log.created_at,
      by: log.actor_full_name || null,
    })),
  ];
  return timeline.sort((a, b) => new Date(a.at) - new Date(b.at));
}

function toNumberOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumPrices(items, key) {
  return items.reduce((total, item) => total + toNumberOrZero(item[key]), 0);
}

// Landing Cost Breakdown auto totals (item 2), "where possible": hotels/
// tours/activities/transfers draw from the Product Catalog (same formula as
// the Custom FIT costing panel, with tours+activities merged into one
// "Activities / Tours Cost" line per this task's spec); Conference/Venue and
// Miscellaneous have no catalog source, so they're always manual (auto 0).
function computeAutoCosting({ hotels, tours, transfers, activities, groupSize }) {
  return {
    hotelCostAuto: sumPrices(hotels, 'price_per_night'),
    toursActivitiesCostAuto: sumPrices(tours, 'price') + sumPrices(activities, 'price_per_pax') * Math.max(groupSize, 1),
    transferCostAuto: sumPrices(transfers, 'price'),
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

// Costing is admin-only (this whole controller), so — unlike a future
// agent-facing MICE serializer, not built in this task — catalog item
// prices are included in hotels/tours/transfers/activities below, to back
// the Landing Cost Breakdown's per-item display.
async function toDetail(row) {
  const [hotels, tours, transfers, activities, activityHistory, itinerary] = await Promise.all([
    listHotelsForRfq(row.id),
    listToursForRfq(row.id),
    listTransfersForRfq(row.id),
    listActivitiesForRfq(row.id),
    buildActivityHistory(row),
    listItineraryForRfq(row.id),
  ]);

  const breakdown = row.cost_breakdown || {};
  const markup = row.markup_rule || {};

  return {
    ...toListItem(row),
    hallCapacityNeeded: row.hall_capacity_needed,
    seatingStyle: row.seating_style,
    avNeeds: row.av_needs,
    otherRequirements: row.other_requirements,
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
    // Day-wise Itinerary Planner — same composeItinerary the agent builder
    // and its own local equivalent use; admin's ItineraryEditor arranges
    // this same selection into days, it never adds/removes what's selected.
    itinerary: composeItinerary(itinerary.days, itinerary.items, { hotel: hotels, tour: tours, transfer: transfers, activity: activities }),
    // Landing Cost Breakdown + Markup Panel + Quote Summary (items 2/4/5).
    costing: {
      hotels: normalizeComponent(breakdown.hotels),
      toursActivities: normalizeComponent(breakdown.toursActivities),
      transfers: normalizeComponent(breakdown.transfers),
      venue: normalizeComponent(breakdown.venue),
      miscellaneous: normalizeComponent(breakdown.miscellaneous),
    },
    landingCost: row.net_cost_total != null ? Number(row.net_cost_total) : null,
    markupType: markup.type || null,
    markupValue: markup.value != null ? Number(markup.value) : null,
    sellPrice: row.sell_price != null ? Number(row.sell_price) : null,
    // Internal Notes (item 6) — admin-only by construction: this whole
    // controller/serializer is never reachable from agent-facing routes.
    internalNotes: row.internal_notes || '',
    publishedAt: row.published_at,
    publishedBy: row.published_by_user_id
      ? { id: row.published_by_user_id, fullName: row.published_by_full_name }
      : null,
    activityHistory,
  };
}

// Team Portal Quotes & Pricing scoping — mirrors
// packageRequestsAdmin.controller.js's identical quotesPricingScope/
// assertQuotesPricingAccess/blockReadOnlyRole trio.
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

function blockReadOnlyRole(req, res) {
  if (req.user.role === 'relationship_manager') {
    res.status(403).json({ error: 'forbidden', message: 'Quotes & Pricing is view-only on your account.' });
    return true;
  }
  return false;
}

// GET /api/admin/mice-rfqs?status=&search=&eventFrom=&eventTo=&page=&pageSize=
export async function list(req, res, next) {
  try {
    const { status, search, eventFrom, eventTo, page, pageSize } = req.query;
    const scope = await quotesPricingScope(req);
    if (scope.agencyIds?.length === 0) {
      return res.json({ miceRfqs: [], pagination: { total: 0, page: 1, pageSize: Number(pageSize) || 20, totalPages: 1 } });
    }
    const { rows, total, page: currentPage, pageSize: limit } = await listMiceRfqsForAdmin({
      status, search, eventFrom, eventTo, page, pageSize, ...scope,
    });

    res.json({
      miceRfqs: rows.map(toListItem),
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

// GET /api/admin/mice-rfqs/:id
export async function get(req, res, next) {
  try {
    const row = await findMiceRfqForAdmin(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, row))) return res.status(404).json({ error: 'not_found' });
    res.json({ miceRfq: await toDetail(row) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/mice-rfqs/lead-manager-candidates — same staff pool as the
// Custom FIT Quote Inbox's "Assign a Lead Manager" control.
export async function listLeadManagerCandidates(req, res, next) {
  try {
    const staff = await listStaff();
    res.json({ staff: staff.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/mice-rfqs/:id/lead-manager — REL-3. Unlike Custom FIT,
// the doc's mice_rfqs status enum has no 'assigned' state (assignment there
// happens alongside costing, MICE-10) — this task only assigns the contact,
// no status transition.
export async function assignLeadManager(req, res, next) {
  try {
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const { leadManagerUserId } = req.body;

    const current = await findMiceRfqForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });

    if (leadManagerUserId) {
      const candidate = await findUserById(leadManagerUserId);
      if (!candidate || candidate.agency_id !== null) {
        return res.status(400).json({ error: 'invalid_lead_manager', message: 'Not a valid staff member' });
      }
    }

    await updateMiceRfqLeadManager(id, leadManagerUserId || null);

    if (leadManagerUserId) {
      // doc §13: lead:assigned -> staff (assigned user).
      getIo()?.to(`user:${leadManagerUserId}`).emit('lead:assigned', {
        miceRfqId: id,
        destination: current.destination,
      });
      // Agent MICE Request workflow (item 7) — same event/room the agent's
      // "My MICE Requests" list already listens on, so status updates
      // (here: Submitted -> Under Review) land live instead of on next load.
      getIo()?.to(`agency:${current.agency_id}`).emit('quote:status_changed', {
        miceRfqId: id,
        status: current.status,
      });
      // Activity Timeline (item 8) — only logged on an actual assignment,
      // matching the example entry ("Lead Manager Assigned").
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'mice_rfq',
        entityId: id,
        field: 'lead_manager_user_id',
        oldValue: { leadManagerUserId: current.lead_manager_user_id },
        newValue: { leadManagerUserId },
      });

      // Task 4, event 2 — Lead Manager Assigned. `candidate` above is scoped
      // to the earlier validation block, so it's re-fetched here rather than
      // widening that block's scope (mirrors packageRequestsAdmin.controller.js).
      const leadManager = await findUserById(leadManagerUserId);
      await createNotification({
        recipientUserId: current.created_by_user_id,
        type: 'mice_lead_manager_assigned',
        title: 'Lead Manager assigned',
        message: `${leadManager?.full_name || 'A Lead Manager'} has been assigned as your Lead Manager for the MICE request to ${current.destination}.`,
        referenceType: 'mice_rfq',
        referenceId: id,
      });
    }

    const updatedRow = await findMiceRfqForAdmin(id);
    res.json({ miceRfq: await toDetail(updatedRow) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/mice-rfqs/:id/costing — items 2/3/4/6 ("Save Draft").
// Always saves whatever the form currently holds — Publish (below) is a
// separate, validated step, so a failed publish attempt never discards
// costing/markup/notes edits.
export async function saveCosting(req, res, next) {
  try {
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const current = await findMiceRfqForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, current))) return res.status(404).json({ error: 'not_found' });

    const [hotels, tours, transfers, activities] = await Promise.all([
      listHotelsForRfq(id),
      listToursForRfq(id),
      listTransfersForRfq(id),
      listActivitiesForRfq(id),
    ]);
    const auto = computeAutoCosting({ hotels, tours, transfers, activities, groupSize: current.group_size });

    const { hotelCost, toursActivitiesCost, transferCost, venueCost, miscellaneousCost, markupType, markupValue, internalNotes } = req.body;

    const hotelTotal = hotelCost ?? auto.hotelCostAuto;
    const toursActivitiesTotal = toursActivitiesCost ?? auto.toursActivitiesCostAuto;
    const transferTotal = transferCost ?? auto.transferCostAuto;
    const venueTotal = venueCost ?? 0; // no catalog source — "Conference / Venue Cost (if applicable)"
    const miscTotal = miscellaneousCost ?? 0; // no catalog source
    const landingCost = round2(hotelTotal + toursActivitiesTotal + transferTotal + venueTotal + miscTotal);

    const sellPrice = round2(
      markupType === 'percentage' ? landingCost + (landingCost * markupValue) / 100 : landingCost + markupValue
    );

    const costBreakdown = {
      hotels: { auto: round2(auto.hotelCostAuto), override: hotelCost, total: round2(hotelTotal) },
      toursActivities: { auto: round2(auto.toursActivitiesCostAuto), override: toursActivitiesCost, total: round2(toursActivitiesTotal) },
      transfers: { auto: round2(auto.transferCostAuto), override: transferCost, total: round2(transferTotal) },
      venue: { auto: 0, override: venueCost, total: round2(venueTotal) },
      miscellaneous: { auto: 0, override: miscellaneousCost, total: round2(miscTotal) },
    };
    const markupRule = { type: markupType, value: markupValue };

    // Never regress a proposal that's already published back down to
    // 'costed' just because the admin resaved.
    const nextStatus = ['submitted', 'costed'].includes(current.status) ? 'costed' : current.status;

    await updateMiceRfqCosting(id, {
      costBreakdown, landingCost, markupRule, sellPrice, internalNotes, status: nextStatus,
    });

    // Activity Timeline (item 8) — only when the figure actually changed, so
    // resaving identical numbers doesn't spam the timeline.
    const prevBreakdown = current.cost_breakdown || {};
    if (Number(prevBreakdown.landingCost) !== landingCost && Number(current.net_cost_total) !== landingCost) {
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'mice_rfq',
        entityId: id,
        field: 'cost_breakdown',
        oldValue: { ...prevBreakdown, landingCost: current.net_cost_total },
        newValue: { ...costBreakdown, landingCost },
      });
    }
    const prevMarkup = current.markup_rule || {};
    if (prevMarkup.type !== markupRule.type || toNumberOrZero(prevMarkup.value) !== toNumberOrZero(markupRule.value)) {
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'mice_rfq',
        entityId: id,
        field: 'markup_rule',
        oldValue: prevMarkup,
        newValue: markupRule,
      });
    }

    // Re-fetch with the agency/lead-manager/published-by joins — the write
    // above only returns bare mice_rfqs columns (UPDATE ... RETURNING *),
    // which toDetail()/toListItem() need joined onto (agencyName etc.).
    const updatedRow = await findMiceRfqForAdmin(id);
    res.json({ miceRfq: await toDetail(updatedRow) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/mice-rfqs/:id/itinerary — Day-wise Itinerary Planner: lets
// the admin rearrange/edit the agent's day-by-day plan before or after
// publishing. Always saves whatever the editor currently holds (same "always
// send full state" contract as saveCosting above) — there's no separate
// validate-then-publish step for the itinerary itself. Mirrors
// packageRequestsAdmin.controller.js's saveItinerary.
export async function saveItinerary(req, res, next) {
  try {
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const current = await findMiceRfqForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, current))) return res.status(404).json({ error: 'not_found' });

    await updateMiceRfqItinerary(id, req.body.days);

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'mice_rfq',
      entityId: id,
      field: 'itinerary',
      newValue: { dayCount: req.body.days.length },
    });

    const updated = await findMiceRfqForAdmin(id);
    res.json({ miceRfq: await toDetail(updated) });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/mice-rfqs/:id/publish — items 7/9. Validates against
// whatever's already been saved via saveCosting above (no body) — the FE
// calls PATCH .../costing immediately before this so the admin's latest
// edits are persisted either way, pass or fail.
export async function publish(req, res, next) {
  try {
    if (blockReadOnlyRole(req, res)) return;
    const { id } = req.params;
    const current = await findMiceRfqForAdmin(id);
    if (!current) return res.status(404).json({ error: 'not_found' });
    if (!(await assertQuotesPricingAccess(req, current))) return res.status(404).json({ error: 'not_found' });

    const errors = [];
    if (!current.lead_manager_user_id) errors.push('Assign a Lead Manager before publishing.');
    const sellPrice = Number(current.sell_price);
    if (!(sellPrice > 0)) errors.push('Final selling price is invalid — check the costing and markup.');

    if (errors.length) {
      return res.status(400).json({ error: 'validation_error', message: errors.join(' ') });
    }

    await publishMiceRfq(id, req.user.id);

    // Agent MICE Request workflow (item 7): Publish Proposal, and — when
    // this fires a second time after a Revision Requested cycle — the
    // admin's response to that revision, both covered by the same event.
    getIo()?.to(`agency:${current.agency_id}`).emit('quote:status_changed', {
      miceRfqId: id,
      status: 'published',
    });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'mice_rfq',
      entityId: id,
      field: 'status',
      oldValue: { status: current.status },
      newValue: { status: 'published' },
    });

    // Task 4, event 3 — Proposal Published.
    await createNotification({
      recipientUserId: current.created_by_user_id,
      type: 'mice_proposal_published',
      title: 'Your MICE proposal is ready',
      message: `Your MICE proposal for ${current.destination} has been published and is ready for review.`,
      referenceType: 'mice_rfq',
      referenceId: id,
    });

    // Re-fetch with the agency/lead-manager/published-by joins (see the
    // same comment in saveCosting above).
    const updatedRow = await findMiceRfqForAdmin(id);
    res.json({ miceRfq: await toDetail(updatedRow) });
  } catch (err) {
    next(err);
  }
}
