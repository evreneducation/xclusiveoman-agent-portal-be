// Hotel occupancy — two different capture models, one per builder:
//
// FD Packages (fdPackages.model.js): admin types a headcount directly per
// hotel-day; price_per_night is a single-room rate for up to 2 adults, so a
// room always costs exactly 1× that rate whether it holds 1 or 2 people —
// see roomsForAdults.
//
// Custom FIT Package Builder (packageRequests.model.js /
// packageRequestsAdmin.controller.js): headcount is already known from Trip
// Details (package_requests.pax_adults), so the agent only picks how that
// fixed headcount is splitting into rooms — Single/Double/Triple — see
// roomsForOccupancy.
//
// No count/type set (legacy items, or a fresh placement before anyone's
// touched the occupancy field) defaults to 1 room, matching the flat
// per-night pricing both of these replaced.
export function roomsForAdults(adults) {
  const n = Number(adults) || 0;
  return n > 0 ? Math.ceil(n / 2) : 1;
}

// capacity = adults per room for that occupancy type. Unset/unrecognized
// defaults to 'double' (2/room) — the same baseline FD Packages' DEFAULT_
// HOTEL_ADULTS assumed before this split.
const OCCUPANCY_CAPACITY = { single: 1, double: 2, triple: 3 };

export function roomsForOccupancy(totalAdults, occupancy) {
  const capacity = OCCUPANCY_CAPACITY[occupancy] || OCCUPANCY_CAPACITY.double;
  const n = Number(totalAdults) || 0;
  return n > 0 ? Math.ceil(n / capacity) : 1;
}
