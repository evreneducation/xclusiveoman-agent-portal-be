import { pool } from '../db/pool.js';
import { hotelsModel, toursModel, transfersModel, activitiesModel, mealsModel, visaModel, flightsModel } from './catalog.model.js';
import { roomsForAdults } from '../utils/occupancy.js';
import { parseDurationDays } from '../utils/meals.js';

const FD_COLUMNS = [
  'title', 'theme', 'duration', 'hero_image_url', 'short_description',
  'suitable_age_min', 'is_featured', 'is_bestseller', 'status',
  'images', 'hotel_id', 'rate_per_pax',
  // Meals (lunch/dinner) are opt-in fd_addons rows now, not columns here —
  // see 0075_fd_meal_addons.sql.
  // Task 5 — "included or not" (0062_fd_addons_transfer_visa.sql).
  'visa_enabled',
  // Flights section (0064_fd_package_flights.sql) — at most one Onward +
  // one Return flight included directly, mutually exclusive in the editor
  // with offering flights as a fd_addons checkbox add-on instead.
  'flights_enabled', 'onward_flight_id', 'return_flight_id',
  // Client-facing Inclusions/Exclusions — see
  // 0050_fd_packages_inclusions_exclusions.sql.
  'inclusions', 'exclusions',
];

export async function listFdPackages({ status, destination, theme, featured, bestseller } = {}) {
  const clauses = [];
  const values = [];
  let i = 1;

  if (status) {
    clauses.push(`fd_packages.status = $${i}`);
    values.push(status);
    i += 1;
  } else {
    clauses.push(`fd_packages.status = 'published'`); // default agent-facing view
  }
  if (theme) {
    clauses.push(`fd_packages.theme = $${i}`);
    values.push(theme);
    i += 1;
  }
  if (featured === 'true') clauses.push('fd_packages.is_featured = true');
  if (bestseller === 'true') clauses.push('fd_packages.is_bestseller = true');
  if (destination) {
    // fd_packages has no dedicated "destination" column — the closest real
    // signal is the linked hotel's city, so match that alongside the title.
    clauses.push(`(fd_packages.title ILIKE $${i} OR hotels.city ILIKE $${i})`);
    values.push(`%${destination}%`);
    i += 1;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT fd_packages.*, hotels.city AS hotel_city, hotels.name AS hotel_name
     FROM fd_packages
     LEFT JOIN hotels ON hotels.id = fd_packages.hotel_id
     ${where}
     ORDER BY fd_packages.created_at DESC`,
    values
  );
  return rows;
}

// Admin catalog card (ProductCatalog → FD Packages) shows a seats-left
// progress bar and a departure date range per package, so roll up each
// package's fd_departure_dates here rather than making the admin UI fetch
// every package's dates one by one.
export async function listAllFdPackagesForAdmin() {
  const { rows } = await pool.query(`
    SELECT fd_packages.*,
      hotels.name AS hotel_name,
      COALESCE(seat_agg.seats_total, 0) AS seats_total,
      COALESCE(seat_agg.seats_booked, 0) AS seats_booked,
      seat_agg.first_date,
      seat_agg.last_date
    FROM fd_packages
    LEFT JOIN hotels ON hotels.id = fd_packages.hotel_id
    LEFT JOIN LATERAL (
      SELECT SUM(seats_total) AS seats_total, SUM(seats_booked) AS seats_booked,
        MIN(date) AS first_date, MAX(date) AS last_date
      FROM fd_departure_dates
      WHERE fd_departure_dates.fd_package_id = fd_packages.id
    ) seat_agg ON true
    ORDER BY fd_packages.created_at DESC
  `);
  return rows;
}

export async function findFdPackageById(id) {
  const { rows } = await pool.query(
    `SELECT fd_packages.*, hotels.name AS hotel_name
     FROM fd_packages
     LEFT JOIN hotels ON hotels.id = fd_packages.hotel_id
     WHERE fd_packages.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function createFdPackage(fields) {
  const cols = FD_COLUMNS.filter((c) => fields[c] !== undefined);
  const values = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, idx) => `$${idx + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO fd_packages (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values
  );
  return rows[0];
}

// fd_itinerary_days/items, fd_departure_dates, and fd_addons all cascade off
// fd_package_id (ON DELETE CASCADE). bookings.fd_departure_date_id does not
// — it has no cascade — so this throws a Postgres 23503 (foreign_key_violation),
// surfaced by errorHandler.js as a 409, if any booking still exists against
// one of this package's departure dates. That's intentional: a package with
// real bookings shouldn't just vanish.
export async function deleteFdPackage(id) {
  await pool.query('DELETE FROM fd_packages WHERE id = $1', [id]);
}

export async function updateFdPackage(id, fields) {
  const cols = FD_COLUMNS.filter((c) => fields[c] !== undefined);
  if (cols.length === 0) return findFdPackageById(id);

  const setClauses = cols.map((c, idx) => `${c} = $${idx + 1}`);
  const values = cols.map((c) => fields[c]);
  values.push(id);

  const { rows } = await pool.query(
    `UPDATE fd_packages SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values
  );
  const updated = rows[0] || null;
  if (updated && cols.includes('duration')) {
    await repriceMealAddons(id, updated.duration);
  }
  return updated;
}

// --- Day-by-day itinerary builder ---
// Mirrors package_request_itinerary_days/items and
// packageRequests.model.js's listItineraryForRequest/replaceItinerary/
// composeItinerary — see 0034_fd_itinerary_items.sql. Days are virtual (Day
// 1..N derived from Duration by the caller) — only a day's notes and its
// assigned items persist, and only for days that actually have something on
// them.
export async function listItineraryForPackage(fdPackageId) {
  const [{ rows: days }, { rows: items }] = await Promise.all([
    pool.query('SELECT * FROM fd_itinerary_days WHERE fd_package_id = $1 ORDER BY day_number', [fdPackageId]),
    pool.query(
      'SELECT * FROM fd_itinerary_items WHERE fd_package_id = $1 ORDER BY day_number, position',
      [fdPackageId]
    ),
  ]);
  return { days, items };
}

// Same "always send full state, clear and reinsert" shape as
// packageRequests.model.js's replaceItinerary. `days` shape: [{ dayNumber,
// notes, items: [{ type, id, note?, adults? }] }] — position within a day is
// each item's index in its `items` array. `adults` (hotel occupancy) is only
// meaningful on 'hotel' items; sent as-is for anything else, which just
// leaves the column null since nothing reads it back off a non-hotel row.
// Runs in its own transaction (unlike package-requests' replaceItinerary, an
// FD package's itinerary save isn't part of a larger multi-table request, so
// there's no outer `client` to join).
export async function replaceItinerary(fdPackageId, days) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM fd_itinerary_days WHERE fd_package_id = $1', [fdPackageId]);
    await client.query('DELETE FROM fd_itinerary_items WHERE fd_package_id = $1', [fdPackageId]);

    for (const day of days || []) {
      await client.query(
        'INSERT INTO fd_itinerary_days (fd_package_id, day_number, notes) VALUES ($1, $2, $3)',
        [fdPackageId, day.dayNumber, day.notes || null]
      );
      for (const [position, item] of (day.items || []).entries()) {
        await client.query(
          `INSERT INTO fd_itinerary_items (fd_package_id, day_number, item_type, item_id, position, note, adults)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [fdPackageId, day.dayNumber, item.type, item.id, position, item.note || null, item.adults || null]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return listItineraryForPackage(fdPackageId);
}

// The full catalog, keyed by item type — an FD package's itinerary has no
// separate "agent selection" step first (unlike a Custom FIT request), so
// any hotel/tour/transfer/activity in the catalog can be placed on any day;
// composeItinerary/computeNetRatePerPax resolve each placed item's
// name/city/images/price against these pools. `meal` is here too, for
// computeMealsCost to resolve the package's selected lunch/dinner entries
// against. `visa` (Task 5) is the single-row Visa catalog, read by
// booking.service.js#createFdBooking to price a package's visa_enabled flag
// at booking time. Shared by the admin editor and the agent-facing
// departures endpoints so both resolve itinerary items and price the
// package identically.
export async function loadCatalogPools() {
  const [hotels, tours, transfers, activities, meals, visa, flights] = await Promise.all([
    hotelsModel.list(),
    toursModel.list(),
    transfersModel.list(),
    activitiesModel.list(),
    mealsModel.list(),
    visaModel.list(),
    flightsModel.list(),
  ]);
  // `flight` (0064/0065_fd_package_flights*.sql) is read by resolveRatePerPax
  // below to price a package's onward_flight_id/return_flight_id when
  // flights_enabled — never by composeItinerary/computeNetRatePerPax, since
  // a flight is never placed as a day-by-day itinerary item.
  return { hotel: hotels, tour: tours, transfer: transfers, activity: activities, meal: meals, visa, flight: flights };
}

// Pricing is no longer a manually-entered tiered rate (Gold/Silver/Bronze) —
// it's the sum of what's actually placed in the day-by-day itinerary, so the
// number always matches what the itinerary shows. Each item contributes its
// catalog price once per occurrence: a hotel placed on 3 separate days (the
// single-select-per-day hotel section) counts as 3 nights, matching how a
// real stay would be priced.
const ITEM_PRICE_FIELD = { tour: 'price', transfer: 'price', activity: 'price_per_pax' };

// Hotel occupancy-tiered pricing (0061_hotel_occupancy_pricing.sql, Task 1/6)
// — a hotel's per-pax nightly rate is its double-occupancy room price ÷ 2
// (the "2 adults share a room" baseline this app already assumed everywhere
// before occupancy pricing existed — roomsForAdults' own "unset = 1 room"
// default), falling back to single (÷1) then triple (÷3) if the hotel
// doesn't offer double. Deliberately headcount-independent: an FD package's
// own admin-set rate can't depend on a real group size, since that's only
// known once an agent actually books (agent/pages/DepartureDetail.jsx's
// Traveler Details step) — admin no longer enters an adults count at all
// (fd_itinerary_items.adults stays in the DB for old rows, just unused by
// this formula going forward). Returns null when the hotel has no price on
// any of the three tiers, so callers can tell "free" apart from "not priced".
const HOTEL_RATE_FALLBACK_ORDER = [
  { field: 'double_price', capacity: 2 },
  { field: 'single_price', capacity: 1 },
  { field: 'triple_price', capacity: 3 },
];

export function resolveHotelPerPaxRate(hotel) {
  if (!hotel) return null;
  for (const { field, capacity } of HOTEL_RATE_FALLBACK_ORDER) {
    if (hotel[field] != null) return Number(hotel[field]) / capacity;
  }
  return null;
}

export function computeNetRatePerPax(items, pools) {
  return (items || []).reduce((total, it) => {
    if (it.item_type === 'hotel') {
      const hotel = (pools.hotel || []).find((h) => h.id === it.item_id);
      const perPax = resolveHotelPerPaxRate(hotel);
      return perPax != null ? total + perPax : total;
    }
    const field = ITEM_PRICE_FIELD[it.item_type];
    const ref = field && (pools[it.item_type] || []).find((p) => p.id === it.item_id);
    if (!ref) return total;
    return total + (Number(ref[field]) || 0);
  }, 0);
}

// The effective net rate: fdPackage.rate_per_pax when the admin has set an
// override, else the itinerary total plus any included visa (Task 5 — a
// checkbox-only inclusion priced off the visa catalog's flat per-person
// rate). Shared by every reader (admin catalog, agent listing/detail,
// booking) so they never disagree about which price applies.
// Flights (0064/0065_fd_package_flights*.sql) only ever contribute here when
// flights_enabled — the direct-inclusion pick, not the add-on checkbox path.
// A flight added as a fd_addons row instead is deliberately *not* folded in
// here: add-ons are an opt-in a-la-carte charge the agent applies at booking
// time (see booking.service.js), never part of the package's own advertised
// net rate, same as Activities/Tours/Transfers/Meals offered as add-ons
// already aren't. Only Onward/Return picked directly here behave like Visa
// above — an always-included cost baked into the rate.
function resolveFlightsPerPax(fdPackage, pools) {
  if (!fdPackage.flights_enabled) return 0;
  const flights = pools.flight || [];
  const onward = flights.find((f) => f.id === fdPackage.onward_flight_id);
  const ret = flights.find((f) => f.id === fdPackage.return_flight_id);
  return Number(onward?.price || 0) + Number(ret?.price || 0);
}

// Public "Flight Details" section on the departure detail page
// (agent/pages/DepartureDetail.jsx's collapsible Flight Details card) —
// only present when flights are included directly on the package
// (flights_enabled) and both the onward/return flight still resolve in the
// catalog pool (same guard resolveFlightsPerPax above uses). Returns null
// otherwise so the frontend can key "show this section" off whether
// departure.flights came back at all, rather than re-deriving the same
// enabled/resolved checks itself.
export function resolveFlightDetails(fdPackage, pools) {
  if (!fdPackage.flights_enabled) return null;
  const flights = pools.flight || [];
  const onward = flights.find((f) => f.id === fdPackage.onward_flight_id);
  const ret = flights.find((f) => f.id === fdPackage.return_flight_id);
  if (!onward || !ret) return null;
  const toPublicFlight = (f) => ({
    name: f.name,
    source: f.source,
    destination: f.destination,
    departureDate: f.departure_date,
    // 0066_flights_departure_time.sql — admin-entered "HH:MM:SS" (or null for
    // a flight that predates this column); the frontend formats it for display.
    departureTime: f.departure_time,
  });
  return { onward: toPublicFlight(onward), return: toPublicFlight(ret) };
}

// fd_packages.hotel_id is a legacy column from before hotels were placed
// directly on the day-by-day itinerary (like tours/transfers/activities
// already are) — FdPackageEditor.jsx has no "select the package's hotel"
// field any more, only per-day hotel placement (setHotelForDay), so
// hotel_id is never set for a package built in the current admin UI and
// anything keyed off it alone (destination, hotel details) would be null
// forever. This resolves the first hotel actually placed on the itinerary
// instead (`items` here is listItineraryForPackage's raw rows, already
// ordered by day_number, position), falling back to the legacy column only
// for an older package that set it and has no itinerary hotel of its own.
export function resolvePrimaryHotelId(fdPackage, items) {
  const firstHotelItem = (items || []).find((it) => it.item_type === 'hotel');
  return firstHotelItem?.item_id || fdPackage.hotel_id || null;
}

export function resolveRatePerPax(fdPackage, items, pools) {
  if (fdPackage.rate_per_pax != null) return Number(fdPackage.rate_per_pax);
  // Meals are opt-in fd_addons now (0075) — priced onto a booking's total at
  // booking time, never part of the package's advertised net rate.
  const visaPerPax = fdPackage.visa_enabled ? Number(pools.visa?.[0]?.price_per_person || 0) : 0;
  const flightsPerPax = resolveFlightsPerPax(fdPackage, pools);
  return computeNetRatePerPax(items, pools) + visaPerPax + flightsPerPax;
}

// Composes the persisted days/items rows into the [{dayNumber, notes, items:
// [{type, id, name, ...}]}] shape both the admin editor and the agent
// departure detail page read — same logic as packageRequests.model.js's
// composeItinerary, but resolved against the *full* catalog pools rather than
// a pre-selected subset: an FD package has no separate "agent selection"
// step the way a Custom FIT request does, so any catalog item can be placed
// on any day.
export function composeItinerary(days, items, pools) {
  const byDay = new Map();
  for (const d of days) {
    byDay.set(d.day_number, { dayNumber: d.day_number, notes: d.notes || '', items: [] });
  }
  for (const it of items) {
    if (!byDay.has(it.day_number)) {
      byDay.set(it.day_number, { dayNumber: it.day_number, notes: '', items: [] });
    }
    const pool = pools[it.item_type] || [];
    const ref = pool.find((p) => p.id === it.item_id);
    byDay.get(it.day_number).items.push({
      type: it.item_type,
      id: it.item_id,
      name: ref?.name || null,
      city: ref?.city ?? null,
      images: ref?.images ?? undefined,
      note: it.note || '',
      // Occupancy — hotel items only (undefined for everything else, same as
      // a never-set hotel item). `rooms` is the derived room count
      // (computeNetRatePerPax's pricing driver) so consumers don't need to
      // re-derive ceil(adults / 2) themselves just to display it.
      ...(it.item_type === 'hotel' ? { adults: it.adults ?? null, rooms: roomsForAdults(it.adults) } : {}),
    });
  }
  return [...byDay.values()].sort((a, b) => a.dayNumber - b.dayNumber);
}

export async function listDepartureDates(fdPackageId) {
  const { rows } = await pool.query(
    'SELECT * FROM fd_departure_dates WHERE fd_package_id = $1 ORDER BY date',
    [fdPackageId]
  );
  return rows;
}

export async function findDepartureDateById(id) {
  const { rows } = await pool.query('SELECT * FROM fd_departure_dates WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function addDepartureDate(fdPackageId, { date, seatsTotal, location }) {
  const { rows } = await pool.query(
    'INSERT INTO fd_departure_dates (fd_package_id, date, seats_total, location) VALUES ($1, $2, $3, $4) RETURNING *',
    [fdPackageId, date, seatsTotal, location]
  );
  return rows[0];
}

export async function removeDepartureDate(id) {
  await pool.query('DELETE FROM fd_departure_dates WHERE id = $1', [id]);
}

export async function incrementSeatsBooked(client, departureDateId, pax) {
  const { rows } = await client.query(
    `UPDATE fd_departure_dates
     SET seats_booked = seats_booked + $2
     WHERE id = $1 AND seats_total - seats_booked >= $2
     RETURNING *`,
    [departureDateId, pax]
  );
  return rows[0] || null; // null means not enough seats (caller should treat as sold out)
}

export async function listAddons(fdPackageId) {
  const { rows } = await pool.query(
    `SELECT fd_addons.*, activities.name AS activity_name, tours.name AS tour_name,
       transfers.name AS transfer_name, flights.name AS flight_name,
       meals.name AS meal_name, meals.meal_type AS meal_type
     FROM fd_addons
     LEFT JOIN activities ON activities.id = fd_addons.activity_id
     LEFT JOIN tours ON tours.id = fd_addons.tour_id
     LEFT JOIN transfers ON transfers.id = fd_addons.transfer_id
     LEFT JOIN flights ON flights.id = fd_addons.flight_id
     LEFT JOIN meals ON meals.id = fd_addons.meal_id
     WHERE fd_package_id = $1`,
    [fdPackageId]
  );
  return rows;
}

export async function findAddonsByIds(fdPackageId, addonIds) {
  if (!addonIds || addonIds.length === 0) return [];
  const { rows } = await pool.query(
    'SELECT * FROM fd_addons WHERE fd_package_id = $1 AND id = ANY($2::uuid[])',
    [fdPackageId, addonIds]
  );
  return rows;
}

// Task 5 — pricePerPax is derived server-side by the caller (fdPackagesAdmin
// .controller.js#postAddon reads it straight off the selected catalog item)
// rather than admin-typed; `location` is gone, the old manual-entry-only
// concept it existed for. flightId (0064_fd_package_flights.sql) always
// resolves to a pricePerPax of 0 — the flights catalog has no rate column —
// same as every other exclusive option here, just with nothing to charge.
export async function addAddon(fdPackageId, { activityId, tourId, transferId, flightId, mealId, pricePerPax }) {
  const { rows } = await pool.query(
    `INSERT INTO fd_addons (fd_package_id, activity_id, tour_id, transfer_id, flight_id, meal_id, price_per_pax)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [fdPackageId, activityId || null, tourId || null, transferId || null, flightId || null, mealId || null, pricePerPax]
  );
  return rows[0];
}

// Meal add-on prices are price_per_day x the package's Duration, so a later
// Duration change has to reprice them (activities/tours/transfers/flights
// don't depend on Duration and keep their add-time snapshot). Called from
// updateFdPackage whenever `duration` is in the update.
async function repriceMealAddons(fdPackageId, duration) {
  await pool.query(
    `UPDATE fd_addons a
     SET price_per_pax = COALESCE(m.price_per_day, 0) * $2
     FROM meals m
     WHERE m.id = a.meal_id AND a.fd_package_id = $1 AND a.meal_id IS NOT NULL`,
    [fdPackageId, parseDurationDays(duration) || 0]
  );
}

export async function removeAddon(id) {
  await pool.query('DELETE FROM fd_addons WHERE id = $1', [id]);
}
