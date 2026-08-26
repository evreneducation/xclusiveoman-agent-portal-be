import { listDepartureLocations, createDepartureLocation } from '../models/locations.model.js';

// GET /api/departure-locations — read-only picklist for the FD Package
// editor's departure-date Location dropdown. Any authenticated user (admin
// staff or agent) can read it.
export async function list(req, res, next) {
  try {
    const locations = await listDepartureLocations();
    res.json({ locations });
  } catch (err) {
    next(err);
  }
}

// POST /api/departure-locations — staff-only (requireRole gate on this one
// route only, see locations.routes.js; GET above stays open to agents too),
// body already validated against departureLocationSchema. Lets the same
// picker save a location that isn't already in the master list instead of
// that pick only ever living as a one-off string on this one
// fd_departure_dates row.
export async function create(req, res, next) {
  try {
    const location = await createDepartureLocation(req.body.name);
    res.status(201).json({ location });
  } catch (err) {
    next(err);
  }
}
