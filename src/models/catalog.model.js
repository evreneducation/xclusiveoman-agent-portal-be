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
  'price_per_night', 'is_mice_enabled',
]);

export const toursModel = createCrudModel('tours', [
  'name', 'city', 'description', 'duration', 'images', 'category', 'price',
  'group_suitability', 'rating', 'review_count', 'suitable_age_min', 'is_bestseller',
]);

export const activitiesModel = createCrudModel('activities', [
  'name', 'city', 'description', 'duration', 'images', 'price_per_pax',
  'rating', 'review_count', 'suitable_age_min', 'is_bestseller',
]);

export const transfersModel = createCrudModel('transfers', [
  'name', 'type', 'vehicle_class', 'city', 'description',
]);

export const experiencesModel = createCrudModel('experiences', [
  'name', 'description', 'images', 'suitable_group_size_min', 'suitable_group_size_max',
]);
