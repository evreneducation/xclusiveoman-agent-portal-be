import {
  hotelsModel,
  toursModel,
  activitiesModel,
  transfersModel,
  experiencesModel,
  mealsModel,
  inclusionsModel,
  exclusionsModel,
  visaModel,
  flightsModel,
  omanOverviewsModel,
} from '../models/catalog.model.js';
import { uploadBuffer } from '../services/cloudinary.service.js';

const MODELS = {
  hotels: hotelsModel,
  tours: toursModel,
  activities: activitiesModel,
  transfers: transfersModel,
  experiences: experiencesModel,
  meals: mealsModel,
  inclusions: inclusionsModel,
  exclusions: exclusionsModel,
  // Plural key ('visas', not 'visa') purely so catalogHandlersFor's
  // singular response key still comes out right ("visa") — Visa itself is a
  // singleton row, the route/response shape otherwise matches every other
  // list-style catalog entity.
  visas: visaModel,
  flights: flightsModel,
  'oman-overviews': omanOverviewsModel,
};

// Naive `entity.slice(0, -1)` mis-singularizes "activities" -> "activitie"
// (dropping a trailing 's' doesn't undo an "-ies" plural). Every other
// entity name here happens to be a plain "-s" plural, so this is the one
// case that needs a real exception rather than the generic rule — found via
// Task 21 regression testing: ActivityEditor.jsx's `{ activity }` and
// MiceCatalog.jsx's MiceActivityForm `{ activity }` destructure both
// silently got `undefined` because the response key was actually
// "activitie", breaking load-for-edit and post-create list updates.
function singularize(entity) {
  if (entity === 'activities') return 'activity';
  return entity.slice(0, -1);
}

// Builds one set of {list, get, create, update, remove} handlers for a given
// catalog entity name (doc §12.3) rather than repeating the pattern per type.
export function catalogHandlersFor(entity) {
  const model = MODELS[entity];

  return {
    // ?page=/?pageSize= (opt-in — see createCrudModel#list's own comment)
    // currently only exercised by the admin Hotels tab (ProductCatalog.jsx),
    // but available to every entity here since they all share this one
    // handler. Every other caller — the agent-facing catalog browse for all
    // ten entities, admin's own Tours/Activities/Transfers/etc. tabs — still
    // calls this with neither param and gets back the plain
    // `{ [entity]: rows }` shape unchanged.
    async list(req, res, next) {
      try {
        const { city, search, mice, mealType, isFlightOnward, status } = req.query;
        const isMiceEnabled = mice === undefined ? undefined : mice === 'true';
        const isFlightOnwardBool = isFlightOnward === undefined ? undefined : isFlightOnward === 'true';

        const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
        const page = paginate ? Math.max(1, parseInt(req.query.page, 10) || 1) : undefined;
        const pageSize = paginate ? Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 10)) : undefined;

        const result = await model.list({
          city,
          search,
          isMiceEnabled,
          mealType,
          isFlightOnward: isFlightOnwardBool,
          status,
          page,
          pageSize,
        });

        if (paginate) {
          const { rows, total } = result;
          res.json({ [entity]: rows, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
        } else {
          res.json({ [entity]: result });
        }
      } catch (err) {
        next(err);
      }
    },

    async get(req, res, next) {
      try {
        const row = await model.findById(req.params.id);
        if (!row) return res.status(404).json({ error: 'not_found' });
        res.json({ [singularize(entity)]: row });
      } catch (err) {
        next(err);
      }
    },

    async create(req, res, next) {
      try {
        const row = await model.create(req.body);
        res.status(201).json({ [singularize(entity)]: row });
      } catch (err) {
        next(err);
      }
    },

    async update(req, res, next) {
      try {
        const row = await model.update(req.params.id, req.body);
        if (!row) return res.status(404).json({ error: 'not_found' });
        res.json({ [singularize(entity)]: row });
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

// POST /api/admin/<entity>/images — multipart, one or more files at req.files
// (field 'images'). Uploaded up front (before the record exists/is saved) so
// the entity's form can submit a single, already-valid payload — mirrors the
// FD package image-upload pattern (doc §14.3) but isn't scoped to a record
// id since the record may not exist yet on the "Add" form. The optional
// `<singular>Id` body field (e.g. hotelId, tourId) only organizes the
// Cloudinary folder for an in-progress edit; it has no effect on validation.
export function uploadImagesHandlerFor(entity) {
  const idField = `${singularize(entity)}Id`;

  return async function uploadImages(req, res, next) {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'missing_files', message: 'Upload at least one image' });
      }

      const folderId = req.body[idField] || 'new';
      const uploaded = await Promise.all(
        req.files.map((file) => uploadBuffer(file.buffer, { folderParts: [entity, folderId, 'images'] }))
      );

      res.status(201).json({ images: uploaded.map((u) => u.secure_url) });
    } catch (err) {
      next(err);
    }
  };
}

// POST /api/admin/oman-overviews/pdf — single-file, mirrors
// auth.controller.js#uploadLicenseDocument exactly: upload first, then the
// actual create/update call just carries the resulting URL as a plain
// string field (omanOverviewSchema.pdfUrl), same "upload returns a URL"
// convention every catalog image upload above already uses, just one file
// instead of an array and a `resourceType: 'raw'` since Cloudinary doesn't
// treat a PDF as an image to transform.
export async function uploadOmanOverviewPdf(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'Upload a PDF document' });
    }
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: 'invalid_file_type', message: 'Only PDF files are allowed' });
    }
    const uploaded = await uploadBuffer(req.file.buffer, {
      folderParts: ['oman-overviews', 'pdfs'],
      resourceType: 'raw',
    });
    res.status(201).json({ url: uploaded.secure_url });
  } catch (err) {
    next(err);
  }
}
