import { pool } from '../db/pool.js';

const FD_COLUMNS = [
  'title', 'theme', 'duration', 'hero_image_url', 'short_description',
  'suitable_age_min', 'is_featured', 'is_bestseller', 'status',
  'deposit_amount', 'balance_due_days_before', 'rate_gold', 'rate_silver', 'rate_bronze',
];

export async function listFdPackages({ status, destination, theme, featured, bestseller } = {}) {
  const clauses = [];
  const values = [];
  let i = 1;

  if (status) {
    clauses.push(`status = $${i}`);
    values.push(status);
    i += 1;
  } else {
    clauses.push(`status = 'published'`); // default agent-facing view
  }
  if (theme) {
    clauses.push(`theme = $${i}`);
    values.push(theme);
    i += 1;
  }
  if (featured === 'true') clauses.push('is_featured = true');
  if (bestseller === 'true') clauses.push('is_bestseller = true');
  if (destination) {
    clauses.push(`title ILIKE $${i}`);
    values.push(`%${destination}%`);
    i += 1;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM fd_packages ${where} ORDER BY created_at DESC`,
    values
  );
  return rows;
}

export async function listAllFdPackagesForAdmin() {
  const { rows } = await pool.query(`SELECT * FROM fd_packages ORDER BY created_at DESC`);
  return rows;
}

export async function findFdPackageById(id) {
  const { rows } = await pool.query('SELECT * FROM fd_packages WHERE id = $1', [id]);
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

export async function listItineraryDays(fdPackageId) {
  const { rows } = await pool.query(
    'SELECT * FROM fd_itinerary_days WHERE fd_package_id = $1 ORDER BY day_number',
    [fdPackageId]
  );
  return rows;
}

export async function replaceItineraryDays(fdPackageId, days) {
  await pool.query('DELETE FROM fd_itinerary_days WHERE fd_package_id = $1', [fdPackageId]);
  for (const day of days) {
    await pool.query(
      'INSERT INTO fd_itinerary_days (fd_package_id, day_number, description) VALUES ($1, $2, $3)',
      [fdPackageId, day.dayNumber, day.description]
    );
  }
  return listItineraryDays(fdPackageId);
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

export async function addDepartureDate(fdPackageId, { date, seatsTotal }) {
  const { rows } = await pool.query(
    'INSERT INTO fd_departure_dates (fd_package_id, date, seats_total) VALUES ($1, $2, $3) RETURNING *',
    [fdPackageId, date, seatsTotal]
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

export async function addAddon(fdPackageId, { activityId, tourId, pricePerPax }) {
  const { rows } = await pool.query(
    `INSERT INTO fd_addons (fd_package_id, activity_id, tour_id, price_per_pax)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [fdPackageId, activityId || null, tourId || null, pricePerPax]
  );
  return rows[0];
}

export async function removeAddon(id) {
  await pool.query('DELETE FROM fd_addons WHERE id = $1', [id]);
}
