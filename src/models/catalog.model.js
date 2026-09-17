const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

/**
 * Hotels/tours/activities/transfers/experiences (doc §11.2) are structurally
 * similar flat tables, so CRUD is generated once per table from a fixed,
 * trusted column list rather than duplicated five times.
 */

// Several of these generic per-table column lists include JSON columns under
// MySQL (hotels' board_basis_options/images, tours'/activities'/transfers'
// images — see migrations 0005/0011/0029). mysql2 auto-parses JSON columns
// to JS values on read, but a write needs an explicit JSON.stringify or the
// driver may instead try to expand a raw JS array as an IN (?)-style param
// list. Rather than hardcoding which of this factory's column lists are
// JSON, any array/plain-object value handed to create()/update() is
// stringified here — every other value (string/number/boolean/null/Date)
// passes through unchanged.
function serializeValue(v) {
  if (Array.isArray(v) || (v !== null && typeof v === 'object' && !(v instanceof Date))) {
    return JSON.stringify(v);
  }
  return v;
}

function createCrudModel(table, columns) {
  return {
    // `filters.page`/`filters.pageSize` are opt-in (Product Catalog's Hotels
    // table, following FdPackagesTab's same pagination) — when neither is
    // passed this returns the plain rows array exactly as before (every
    // other caller: packageRequestsAdmin.controller.js's mealsModel.list()/
    // visaModel.list(), the agent-facing GET /<entity> catalog.routes.js
    // route for every entity that doesn't opt in). Only when either is
    // present does it run a COUNT(*) alongside a LIMIT/OFFSET query and
    // return `{ rows, total, page, pageSize }` instead — real SQL-level
    // pagination, not a fetch-everything-then-slice-in-JS shortcut, since
    // this is a real table query (unlike the JS-side search/pagination on
    // admin.controller.js#getAgencies etc., which already had to load
    // everything anyway to join in owner/RM data first).
    async list(filters = {}) {
      const clauses = [];
      const values = [];

      if (filters.city) {
        clauses.push(`city = ?`);
        values.push(filters.city);
      }
      if (filters.search) {
        clauses.push(`LOWER(name) LIKE LOWER(?)`);
        values.push(`%${filters.search}%`);
      }
      if (filters.isMiceEnabled !== undefined && columns.includes('is_mice_enabled')) {
        clauses.push(`is_mice_enabled = ?`);
        values.push(filters.isMiceEnabled);
      }
      if (filters.mealType && columns.includes('meal_type')) {
        clauses.push(`meal_type = ?`);
        values.push(filters.mealType);
      }
      if (filters.isFlightOnward !== undefined && columns.includes('is_flight_onward')) {
        clauses.push(`is_flight_onward = ?`);
        values.push(filters.isFlightOnward);
      }
      // Opt-in — only passed by the itinerary-building hotel pickers
      // (FdPackageEditor.jsx, PackageBuilder.jsx, MiceBuilder.jsx), so a
      // draft hotel can't be added to a package before it's ready. The admin
      // management lists (ProductCatalog.jsx, MiceCatalog.jsx) omit this and
      // keep seeing every hotel regardless of status.
      if (filters.status && columns.includes('status')) {
        clauses.push(`status = ?`);
        values.push(filters.status);
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

      if (filters.page === undefined && filters.pageSize === undefined) {
        const { rows } = await pool.query(`SELECT * FROM ${table} ${where} ORDER BY created_at DESC`, values);
        return rows;
      }

      const page = Math.max(1, filters.page || 1);
      const pageSize = Math.max(1, Math.min(100, filters.pageSize || 10));
      const offset = (page - 1) * pageSize;

      const [{ rows: countRows }, { rows }] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS count FROM ${table} ${where}`, values),
        pool.query(
          `SELECT * FROM ${table} ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
          [...values, pageSize, offset]
        ),
      ]);

      return { rows, total: countRows[0].count, page, pageSize };
    },

    async findById(id) {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      return rows[0] || null;
    },

    async create(fields) {
      const cols = columns.filter((c) => fields[c] !== undefined);
      const values = cols.map((c) => serializeValue(fields[c]));
      const id = newId();
      const placeholders = cols.map(() => '?').join(', ');
      await pool.query(
        `INSERT INTO ${table} (id, ${cols.join(', ')}) VALUES (?, ${placeholders})`,
        [id, ...values]
      );
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      return rows[0];
    },

    async update(id, fields) {
      const cols = columns.filter((c) => fields[c] !== undefined);
      if (cols.length === 0) return this.findById(id);

      const setClauses = cols.map((c) => `${c} = ?`);
      const values = cols.map((c) => serializeValue(fields[c]));
      values.push(id);

      await pool.query(
        `UPDATE ${table} SET ${setClauses.join(', ')}, updated_at = now() WHERE id = ?`,
        values
      );
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      return rows[0] || null;
    },

    async remove(id) {
      await pool.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
    },
  };
}

const hotelsModel = createCrudModel('hotels', [
  'name', 'city', 'state', 'address', 'email', 'category', 'board_basis_options',
  'mice_ballroom_capacity', 'mice_breakout_rooms', 'images', 'description',
  // price_per_night is no longer admin-entered directly (HotelEditor.jsx now
  // collects single_price/double_price/triple_price instead) but stays a
  // writable column here — catalog.routes.js's deriveHotelPricePerNight
  // middleware computes it from those three before this model ever sees the
  // request, so it's still populated for MICE quote costing, unchanged.
  'price_per_night', 'single_price', 'double_price', 'triple_price', 'is_mice_enabled',
  // 0070_hotels_status.sql — draft/published; only hotels/list's `status`
  // filter (below) reads it, gating the itinerary-building pickers.
  'status',
]);

module.exports.hotelsModel = hotelsModel;

const toursModel = createCrudModel('tours', [
  'name', 'city', 'description', 'duration', 'images', 'category', 'price',
  'group_suitability', 'rating', 'review_count', 'suitable_age_min', 'is_bestseller',
  'is_mice_enabled',
  // 0078_pickup_time.sql — mandatory on publish (see catalog.routes.js's
  // requireTourPublishFields).
  'pickup_time',
  // 0072_tours_activities_transfers_status.sql — draft/published.
  'status',
]);

module.exports.toursModel = toursModel;

const activitiesModel = createCrudModel('activities', [
  'name', 'city', 'description', 'duration', 'images', 'price_per_pax',
  'rating', 'review_count', 'suitable_age_min', 'is_bestseller', 'is_mice_enabled',
  // 0078_pickup_time.sql — mandatory on publish (see catalog.routes.js's
  // requireActivityPublishFields).
  'pickup_time',
  'status',
]);

module.exports.activitiesModel = activitiesModel;

const transfersModel = createCrudModel('transfers', [
  'name', 'type', 'vehicle_class', 'city', 'description', 'price', 'images', 'is_mice_enabled',
  // 0078_pickup_time.sql — optional, unlike tours/activities above.
  'pickup_time',
  'status',
]);

module.exports.transfersModel = transfersModel;

const experiencesModel = createCrudModel('experiences', [
  'name', 'description', 'images', 'suitable_group_size_min', 'suitable_group_size_max',
]);

module.exports.experiencesModel = experiencesModel;

const mealsModel = createCrudModel('meals', [
  'name', 'city', 'description', 'meal_type', 'price_per_person', 'price_per_day',
]);

module.exports.mealsModel = mealsModel;
const inclusionsModel = createCrudModel('inclusions', ['name']);
module.exports.inclusionsModel = inclusionsModel;
const exclusionsModel = createCrudModel('exclusions', ['name']);
module.exports.exclusionsModel = exclusionsModel;
const visaModel = createCrudModel('visa', ['price_per_person']);
module.exports.visaModel = visaModel;

const flightsModel = createCrudModel('flights', [
  'name', 'source', 'destination', 'departure_date', 'departure_time', 'is_flight_onward', 'price',
]);

module.exports.flightsModel = flightsModel;

const omanOverviewsModel = createCrudModel('oman_overviews', [
  'name', 'description', 'pdf_url', 'cover_image_url',
]);

module.exports.omanOverviewsModel = omanOverviewsModel;
const dealsModel = createCrudModel('deals', ['title', 'duration', 'image_url']);
module.exports.dealsModel = dealsModel;
