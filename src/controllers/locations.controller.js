const {
  listDepartureLocations,
  createDepartureLocation
} = require('../models/locations.model.js');

async function list(req, res, next) {
  try {
    const locations = await listDepartureLocations();
    res.json({ locations });
  } catch (err) {
    next(err);
  }
}

module.exports.list = list;

async function create(req, res, next) {
  try {
    const location = await createDepartureLocation(req.body.name);
    res.status(201).json({ location });
  } catch (err) {
    next(err);
  }
}

module.exports.create = create;
