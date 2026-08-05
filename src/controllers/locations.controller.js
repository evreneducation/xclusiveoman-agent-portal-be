import { listDepartureLocations } from '../models/locations.model.js';

// GET /api/departure-locations — read-only picklist for the FD Package
// editor's departure-date Location dropdown. Any authenticated user (admin
// staff or agent) can read it; there's no write endpoint yet since the list
// is currently admin-seeded (migration 0018) rather than admin-managed.
export async function list(req, res, next) {
  try {
    const locations = await listDepartureLocations();
    res.json({ locations });
  } catch (err) {
    next(err);
  }
}
