function roomsForAdults(adults) {
  const n = Number(adults) || 0;
  return n > 0 ? Math.ceil(n / 2) : 1;
}

module.exports.roomsForAdults = roomsForAdults;

// capacity = adults per room for that occupancy type. Unset/unrecognized
// defaults to 'double' (2/room) — the same baseline FD Packages' DEFAULT_
// HOTEL_ADULTS assumed before this split.
const OCCUPANCY_CAPACITY = { single: 1, double: 2, triple: 3 };

function roomsForOccupancy(totalAdults, occupancy) {
  const capacity = OCCUPANCY_CAPACITY[occupancy] || OCCUPANCY_CAPACITY.double;
  const n = Number(totalAdults) || 0;
  return n > 0 ? Math.ceil(n / capacity) : 1;
}

module.exports.roomsForOccupancy = roomsForOccupancy;
