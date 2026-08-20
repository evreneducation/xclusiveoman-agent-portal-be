import { pool } from '../db/pool.js';

/**
 * Hotels/tours/activities/transfers/experiences (doc §11.2) are structurally
 * similar flat tables, so CRUD is generated once per table from a fixed,
 * trusted column list rather than duplicated five times.
 */
function createCrudModel(table, columns) {
  return {
    async list(filters = {}) {
      const clauses = [];
      const values = [];
      let i = 1;

      if (filters.city) {
        clauses.push(`city = $${i}`);
        values.push(filters.city);
        i += 1;
      }
      if (filters.search) {
        clauses.push(`name ILIKE $${i}`);
        values.push(`%${filters.search}%`);
        i += 1;
      }
      if (filters.isMiceEnabled !== undefined && columns.includes('is_mice_enabled')) {
        clauses.push(`is_mice_enabled = $${i}`);
        values.push(filters.isMiceEnabled);
        i += 1;
      }
      if (filters.mealType && columns.includes('meal_type')) {
        clauses.push(`meal_type = $${i}`);
        values.push(filters.mealType);
        i += 1;
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM ${table} ${where} ORDER BY created_at DESC`,
        values
      );
      return rows;
    },

    async findById(id) {
      const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
      return rows[0] || null;
    },

    async create(fields) {
      const cols = columns.filter((c) => fields[c] !== undefined);
      const values = cols.map((c) => fields[c]);
      const placeholders = cols.map((_, idx) => `$${idx + 1}`);
      const { rows } = await pool.query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
        values
      );
      return rows[0];
    },

    async update(id, fields) {
      const cols = columns.filter((c) => fields[c] !== undefined);
      if (cols.length === 0) return this.findById(id);

      const setClauses = cols.map((c, idx) => `${c} = $${idx + 1}`);
      const values = cols.map((c) => fields[c]);
      values.push(id);

      const { rows } = await pool.query(
        `UPDATE ${table} SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
        values
      );
      return rows[0] || null;
    },

    async remove(id) {
      await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    },
  };
}

export const hotelsModel = createCrudModel('hotels', [
  'name', 'city', 'state', 'address', 'email', 'category', 'board_basis_options',
  'mice_ballroom_capacity', 'mice_breakout_rooms', 'images', 'description',
  // price_per_night is no longer admin-entered directly (HotelEditor.jsx now
  // collects single_price/double_price/triple_price instead) but stays a
  // writable column here — catalog.routes.js's deriveHotelPricePerNight
  // middleware computes it from those three before this model ever sees the
  // request, so it's still populated for MICE quote costing, unchanged.
  'price_per_night', 'single_price', 'double_price', 'triple_price', 'is_mice_enabled',
]);

export const toursModel = createCrudModel('tours', [
  'name', 'city', 'description', 'duration', 'images', 'category', 'price',
  'group_suitability', 'rating', 'review_count', 'suitable_age_min', 'is_bestseller',
  'is_mice_enabled',
]);

export const activitiesModel = createCrudModel('activities', [
  'name', 'city', 'description', 'duration', 'images', 'price_per_pax',
  'rating', 'review_count', 'suitable_age_min', 'is_bestseller', 'is_mice_enabled',
]);

export const transfersModel = createCrudModel('transfers', [
  'name', 'type', 'vehicle_class', 'city', 'description', 'price', 'images', 'is_mice_enabled',
]);

export const experiencesModel = createCrudModel('experiences', [
  'name', 'description', 'images', 'suitable_group_size_min', 'suitable_group_size_max',
]);

// Lunch and Dinner are independent entries (own tab, own save in the admin
// UI), distinguished by meal_type. Price is two independent flat rates —
// price_per_person and price_per_day — not one combined per-pax-per-day
// figure. See 0037_meals.sql / 0038_meals_split_type.sql / 0039_meals_person_day_price.sql.
export const mealsModel = createCrudModel('meals', [
  'name', 'city', 'description', 'meal_type', 'price_per_person', 'price_per_day',
]);

// Product Catalog "Inclusions & Exclusions" tab (see
// 0049_inclusions_exclusions_catalog.sql) — reusable, name-only phrases the
// admin curates for reference when writing a quotation's client-facing
// Inclusions/Exclusions text (Quote Inbox's Costing panel). Two bare tables
// (not one type-discriminated table like meals) since there's nothing else
// to distinguish per row — just a plain name-only CRUD entity each.
export const inclusionsModel = createCrudModel('inclusions', ['name']);
export const exclusionsModel = createCrudModel('exclusions', ['name']);

// Product Catalog "Visa" tab (see 0051_visa_catalog.sql) — a single
// admin-priced rate per person, not a list. The admin UI (ProductCatalog.jsx's
// VisaTab) only ever edits the one row in place, same "one entry" convention
// Meals already uses per meal_type.
export const visaModel = createCrudModel('visa', ['price_per_person']);
