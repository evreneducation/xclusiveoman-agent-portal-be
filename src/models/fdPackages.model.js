import { pool } from '../db/pool.js';

const FD_COLUMNS = [
  'title', 'theme', 'duration', 'hero_image_url', 'short_description',
  'suitable_age_min', 'is_featured', 'is_bestseller', 'status',
  'deposit_amount', 'balance_due_days_before', 'rate_gold', 'rate_silver', 'rate_bronze',
  'images', 'hotel_id',
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
      COALESCE(seat_agg.seats_total, 0) AS seats_total,
      COALESCE(seat_agg.seats_booked, 0) AS seats_booked,
      seat_agg.first_date,
      seat_agg.last_date
    FROM fd_packages
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
  return rows[0] || null;
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
// notes, items: [{ type, id, note? }] }] — position within a day is each
// item's index in its `items` array. Runs in its own transaction (unlike
// package-requests' replaceItinerary, an FD package's itinerary save isn't
// part of a larger multi-table request, so there's no outer `client` to join).
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
          `INSERT INTO fd_itinerary_items (fd_package_id, day_number, item_type, item_id, position, note)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [fdPackageId, day.dayNumber, item.type, item.id, position, item.note || null]
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
    `SELECT fd_addons.*, activities.name AS activity_name, tours.name AS tour_name
     FROM fd_addons
     LEFT JOIN activities ON activities.id = fd_addons.activity_id
     LEFT JOIN tours ON tours.id = fd_addons.tour_id
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

export async function addAddon(fdPackageId, { activityId, tourId, location, pricePerPax }) {
  const { rows } = await pool.query(
    `INSERT INTO fd_addons (fd_package_id, activity_id, tour_id, location, price_per_pax)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [fdPackageId, activityId || null, tourId || null, location || null, pricePerPax]
  );
  return rows[0];
}

export async function removeAddon(id) {
  await pool.query('DELETE FROM fd_addons WHERE id = $1', [id]);
}
