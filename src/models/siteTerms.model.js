const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

const siteTermsModel = {
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
      await pool.query(
        'UPDATE site_terms SET body_html = ?, updated_at = now() WHERE id = ?',
        [bodyHtml, existing.id]
      );
      const { rows } = await pool.query('SELECT * FROM site_terms WHERE id = ?', [existing.id]);
      return rows[0];
    }
    const id = newId();
    await pool.query('INSERT INTO site_terms (id, body_html) VALUES (?, ?)', [id, bodyHtml]);
    const { rows } = await pool.query('SELECT * FROM site_terms WHERE id = ?', [id]);
    return rows[0];
  },
};

module.exports.siteTermsModel = siteTermsModel;
