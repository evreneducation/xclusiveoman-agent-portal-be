const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function listDepartureLocations() {
  const { rows } = await pool.query('SELECT id, name FROM departure_locations ORDER BY name');
  return rows;
}

module.exports.listDepartureLocations = listDepartureLocations;

async function createDepartureLocation(name) {
  await pool.query(
    `INSERT INTO departure_locations (id, name) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [newId(), name]
  );
  const { rows } = await pool.query('SELECT id, name FROM departure_locations WHERE name = ?', [name]);
  return rows[0];
}

module.exports.createDepartureLocation = createDepartureLocation;
