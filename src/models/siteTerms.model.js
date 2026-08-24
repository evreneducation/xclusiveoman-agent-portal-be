import { pool } from '../db/pool.js';

// Admin "Terms & Conditions" tab — a singleton row (0067_site_terms.sql),
// the same "one row, get-or-create then always patch it" shape
// visaModel/mealsModel (catalog.model.js) already use for their own single-
// rate/per-type rows. Kept as its own tiny model rather than folded into
// catalog.model.js's generic createCrudModel factory — this isn't a
// bookable catalog product, it's site-wide policy content with exactly one
// field, so a plain get/upsert pair is simpler than that factory's full
// list/findById/create/update/remove surface.
export const siteTermsModel = {
  async get() {
    const { rows } = await pool.query('SELECT * FROM site_terms ORDER BY created_at ASC LIMIT 1');
    return rows[0] || null;
  },

  // Creates the one row on the first save, patches it in place on every
  // save after that — same "create it if nothing exists yet, otherwise
  // update it" flow ProductCatalog.jsx's own VisaForm/MealForm already use
  // client-side, just done here in one round trip instead of the frontend
  // having to know which one to call.
  async upsert(bodyHtml) {
    const existing = await this.get();
    if (existing) {
      const { rows } = await pool.query(
        'UPDATE site_terms SET body_html = $1, updated_at = now() WHERE id = $2 RETURNING *',
        [bodyHtml, existing.id]
      );
      return rows[0];
    }
    const { rows } = await pool.query('INSERT INTO site_terms (body_html) VALUES ($1) RETURNING *', [bodyHtml]);
    return rows[0];
  },
};
