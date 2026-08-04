import {
  listPackageRequestsForAdmin,
  findPackageRequestForAdmin,
  updatePackageRequestLeadManager,
} from '../models/packageRequestsAdmin.model.js';
// Read helpers reused as-is from the agent-side FIT Package Builder model —
// imported only, never modified, so that module stays untouched.
import {
  listHotelsForRequest,
  listToursForRequest,
  listTransfersForRequest,
  listActivitiesForRequest,
  listTravelersForRequest,
} from '../models/packageRequests.model.js';
import { listStaff, findUserById, toPublicUser } from '../models/users.model.js';
import { getIo } from '../sockets/index.js';

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

// Blind pricing (doc §15 rule 65 / FIT-6, item 7 of this task): identical
// guarantee to the agent-facing serializer — net_cost_breakdown, markup_rule,
// sell_price and every catalog item's price field are left out here too. The
// Quote Inbox precedes costing, which is a separate, later task.
async function toDetail(row) {
  const [hotels, tours, transfers, activities, travelers] = await Promise.all([
    listHotelsForRequest(row.id),
    listToursForRequest(row.id),
    listTransfersForRequest(row.id),
    listActivitiesForRequest(row.id),
    listTravelersForRequest(row.id),
  ]);

  return {
    ...toListItem(row),
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
    })),
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
    }

    const updatedRow = await findPackageRequestForAdmin(id);
    res.json({ packageRequest: await toDetail(updatedRow) });
  } catch (err) {
    next(err);
  }
}
