import { pool } from '../db/pool.js';
import { getIo } from '../sockets/index.js';
import {
  createPackageRequest,
  addHotelSelections,
  addTourSelections,
  addTransferSelections,
  addActivitySelections,
  addTravelers,
  findPackageRequestById,
  listHotelsForRequest,
  listToursForRequest,
  listTransfersForRequest,
  listActivitiesForRequest,
  listTravelersForRequest,
} from '../models/packageRequests.model.js';

// Blind pricing (doc §15 rule 65 / FIT-6): net_cost_breakdown, markup_rule,
// sell_price and every catalog item's price field are stripped here in the
// serializer, not just hidden in the UI, so this response never carries cost
// data even if a client requests it directly.
async function toPublicPackageRequest(id) {
  const packageRequest = await findPackageRequestById(id);
  if (!packageRequest) return null;

  const [hotels, tours, transfers, activities, travelers] = await Promise.all([
    listHotelsForRequest(id),
    listToursForRequest(id),
    listTransfersForRequest(id),
    listActivitiesForRequest(id),
    listTravelersForRequest(id),
  ]);

  return {
    id: packageRequest.id,
    destination: packageRequest.destination,
    dateFrom: packageRequest.date_from,
    dateTo: packageRequest.date_to,
    paxAdults: packageRequest.pax_adults,
    paxChildren: packageRequest.pax_children,
    status: packageRequest.status,
    createdAt: packageRequest.created_at,
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

// POST /api/package-requests — FIT-1..FIT-7: submits the wizard in one atomic
// step (destination/dates/pax + hotel/tour/transfer/activity selections +
// travellers), landing it in the admin Quote Inbox as `submitted`. Costing,
// markup and publishing are a separate, later task.
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

    // doc §13: new FIT/MICE submission — live badge counts on the (separate,
    // not-yet-built) admin Quote Inbox. No-op if nobody's listening yet.
    getIo()?.to('role:ops_admin').emit('queue:new_item', {
      type: 'package_request',
      packageRequestId: packageRequest.id,
      destination: packageRequest.destination,
    });

    res.status(201).json({ packageRequest: await toPublicPackageRequest(packageRequest.id) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// GET /api/package-requests/:id — agent's own submission only.
export async function get(req, res, next) {
  try {
    const packageRequest = await findPackageRequestById(req.params.id);
    if (!packageRequest || packageRequest.agency_id !== req.user.agency_id) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.json({ packageRequest: await toPublicPackageRequest(packageRequest.id) });
  } catch (err) {
    next(err);
  }
}
