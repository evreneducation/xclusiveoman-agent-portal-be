import {
  hotelsModel,
  toursModel,
  activitiesModel,
  transfersModel,
  experiencesModel,
} from '../models/catalog.model.js';

const MODELS = {
  hotels: hotelsModel,
  tours: toursModel,
  activities: activitiesModel,
  transfers: transfersModel,
  experiences: experiencesModel,
};

// Builds one set of {list, get, create, update, remove} handlers for a given
// catalog entity name (doc §12.3) rather than repeating the pattern per type.
export function catalogHandlersFor(entity) {
  const model = MODELS[entity];

  return {
    async list(req, res, next) {
      try {
        const { city, search, mice } = req.query;
        const isMiceEnabled = mice === undefined ? undefined : mice === 'true';
        const rows = await model.list({ city, search, isMiceEnabled });
        res.json({ [entity]: rows });
      } catch (err) {
        next(err);
      }
    },

    async get(req, res, next) {
      try {
        const row = await model.findById(req.params.id);
        if (!row) return res.status(404).json({ error: 'not_found' });
        res.json({ [entity.slice(0, -1)]: row });
      } catch (err) {
        next(err);
      }
    },

    async create(req, res, next) {
      try {
        const row = await model.create(req.body);
        res.status(201).json({ [entity.slice(0, -1)]: row });
      } catch (err) {
        next(err);
      }
    },

    async update(req, res, next) {
      try {
        const row = await model.update(req.params.id, req.body);
        if (!row) return res.status(404).json({ error: 'not_found' });
        res.json({ [entity.slice(0, -1)]: row });
      } catch (err) {
        next(err);
      }
    },

    async remove(req, res, next) {
      try {
        await model.remove(req.params.id);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  };
}
