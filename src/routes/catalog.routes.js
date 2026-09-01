import { Router } from 'express';
import { catalogHandlersFor, uploadImagesHandlerFor, uploadOmanOverviewPdf, uploadDealImage } from '../controllers/catalog.controller.js';
import { hotelsModel, toursModel, activitiesModel, transfersModel } from '../models/catalog.model.js';
import { requireAuth, requireRole, requireFeature, STAFF_ROLES } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import {
  validateBody,
  hotelSchema,
  tourSchema,
  activitySchema,
  transferSchema,
  experienceSchema,
  mealSchema,
  nameOnlyCatalogSchema,
  visaSchema,
  flightSchema,
  omanOverviewSchema,
  dealSchema,
  toSnakeCaseColumns,
} from '../validation/schemas.js';

const router = Router();

function toColumns(req, res, next) {
  req.body = toSnakeCaseColumns(req.body);
  next();
}

// Hotel occupancy-tiered pricing (0061_hotel_occupancy_pricing.sql) —
// derives the legacy price_per_night column from whichever occupancy price
// was actually submitted (priority double -> single -> triple, the same
// "2 adults per room" baseline this app already assumed everywhere before
// occupancy pricing existed), so MICE quote costing (miceRfqsAdmin.
// controller.js), which still reads price_per_night as-is, keeps working
// without the admin ever entering it directly. Only touches the body when at
// least one occupancy price is actually present in this request — a PATCH
// that only changes e.g. the description shouldn't blank out an
// already-set price_per_night.
function deriveHotelPricePerNight(req, res, next) {
  const { double_price: doublePrice, single_price: singlePrice, triple_price: triplePrice } = req.body;
  if (doublePrice != null || singlePrice != null || triplePrice != null) {
    req.body.price_per_night = doublePrice ?? singlePrice ?? triplePrice;
  }
  next();
}

const HOTEL_REQUIRED_ON_PUBLISH = ['name', 'city', 'state', 'address', 'email', 'category', 'description'];
const HOTEL_PRICE_FIELDS = ['price_per_night', 'single_price', 'double_price', 'triple_price'];

// `description` is rich text now (shared/components/RichTextEditor.jsx) —
// its empty state is `<p></p>`, not `''`. Mirrors the frontend's own
// isEmptyHtml (RichTextEditor.jsx) so a required-but-still-blank rich text
// field is rejected the same way here as it already is client-side.
const HTML_REQUIRED_FIELDS = new Set(['description']);

function isFieldEmpty(field, value) {
  if (HTML_REQUIRED_FIELDS.has(field)) return !value || !String(value).replace(/<[^>]*>/g, '').trim();
  return value === undefined || value === null || value === '';
}

// Same "only checked at the moment of publishing" gate FD packages use
// (fdPackagesAdmin.controller.js's carouselImagesError/heroImageError) —
// hotelSchema no longer requires any of these up front (0070_hotels_status.sql),
// so HotelEditor.jsx's draft autosave can save a half-filled hotel; this is
// what stops one from actually going live incomplete, whether through the UI
// or a direct API call. Runs after deriveHotelPricePerNight so price_per_night
// is already derived from whichever occupancy price was submitted. PATCH
// bodies are partial, so a field this request doesn't touch falls back to
// whatever's already saved (mirrors fdPackagesAdmin.controller.js#update's
// finalStatus/finalImages pattern) — req.params.id is undefined on a create,
// so `existing` is just null there and every field must come from the body.
async function requireHotelPublishFields(req, res, next) {
  try {
    const existing = req.params.id ? await hotelsModel.findById(req.params.id) : null;
    const finalStatus = req.body.status !== undefined ? req.body.status : existing?.status;
    if (finalStatus !== 'published') return next();

    const finalOf = (field) => (req.body[field] !== undefined ? req.body[field] : existing?.[field]);

    for (const field of HOTEL_REQUIRED_ON_PUBLISH) {
      if (isFieldEmpty(field, finalOf(field))) {
        return res.status(400).json({ error: 'validation_error', message: 'Please fill in all required fields before publishing.' });
      }
    }
    const images = finalOf('images');
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'validation_error', message: 'Upload at least one image before publishing.' });
    }
    if (!HOTEL_PRICE_FIELDS.some((field) => Number(finalOf(field)) > 0)) {
      return res
        .status(400)
        .json({ error: 'validation_error', message: 'Set a price for at least one occupancy type before publishing.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Generalized version of requireHotelPublishFields just above, for tours/
// activities/transfers (0072_tours_activities_transfers_status.sql) — same
// "only checked at the moment of publishing" shape, just table- and
// field-list-driven instead of hardcoded to hotels, since these three don't
// each need hotels' bespoke occupancy-price derivation step. `priceFields`
// mirrors HOTEL_PRICE_FIELDS's "at least one must be a positive number"
// check; pass an empty array for an entity whose price is genuinely optional
// even at publish (matches that entity's own validate*Form.js on the client).
function createPublishFieldsGate(model, { requiredFields, requireImages = false, priceFields = [] }) {
  return async function requirePublishFields(req, res, next) {
    try {
      const existing = req.params.id ? await model.findById(req.params.id) : null;
      const finalStatus = req.body.status !== undefined ? req.body.status : existing?.status;
      if (finalStatus !== 'published') return next();

      const finalOf = (field) => (req.body[field] !== undefined ? req.body[field] : existing?.[field]);

      for (const field of requiredFields) {
        if (isFieldEmpty(field, finalOf(field))) {
          return res.status(400).json({ error: 'validation_error', message: 'Please fill in all required fields before publishing.' });
        }
      }
      if (requireImages) {
        const images = finalOf('images');
        if (!images || images.length === 0) {
          return res.status(400).json({ error: 'validation_error', message: 'Upload at least one image before publishing.' });
        }
      }
      if (priceFields.length && !priceFields.some((field) => Number(finalOf(field)) > 0)) {
        return res.status(400).json({ error: 'validation_error', message: 'Set a price before publishing.' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Field lists mirror each entity's own admin/lib/*Form.js exactly
// (TOUR_REQUIRED_FIELDS, ACTIVITY_REQUIRED_FIELDS, TRANSFER_REQUIRED_FIELDS).
// Column names are snake_case — this gate runs after toSnakeCaseColumns.
// Only enforced when the row is being published; drafts stay lenient.
const requireTourPublishFields = createPublishFieldsGate(toursModel, {
  requiredFields: ['name', 'city', 'description', 'duration', 'category', 'pickup_time'],
  requireImages: true,
  priceFields: ['price'],
});
const requireActivityPublishFields = createPublishFieldsGate(activitiesModel, {
  requiredFields: ['name', 'city', 'description', 'duration', 'pickup_time'],
  requireImages: true,
  priceFields: ['price_per_pax'],
});
// pickup_time deliberately left out of transfers' requiredFields — Pickup
// Time is optional for Transfers, unlike Tours/Activities above
// (0078_pickup_time.sql).
const requireTransferPublishFields = createPublishFieldsGate(transfersModel, {
  requiredFields: ['name', 'type', 'city', 'description', 'vehicle_class'],
  requireImages: true,
  priceFields: ['price'],
});

const ENTITIES = [
  { path: 'hotels', schema: hotelSchema },
  { path: 'tours', schema: tourSchema },
  { path: 'activities', schema: activitySchema },
  { path: 'transfers', schema: transferSchema },
  { path: 'experiences', schema: experienceSchema },
  { path: 'meals', schema: mealSchema },
  { path: 'inclusions', schema: nameOnlyCatalogSchema },
  { path: 'exclusions', schema: nameOnlyCatalogSchema },
  { path: 'visas', schema: visaSchema },
  { path: 'flights', schema: flightSchema },
  // Content Hub "Oman Overview" (0081_oman_overviews.sql) — no publish gate
  // in EXTRA_MIDDLEWARE below since omanOverviewSchema already requires
  // every field up front (same posture as flightSchema above).
  { path: 'oman-overviews', schema: omanOverviewSchema },
  // Admin sidebar "Deals" tab (0082_deals.sql) — no publish gate below, same
  // reasoning as Oman Overview above (dealSchema already requires everything
  // up front).
  { path: 'deals', schema: dealSchema },
];

// Public-to-agents listing/detail (doc §12.3) — any authenticated user, agent or staff.
for (const { path } of ENTITIES) {
  const handlers = catalogHandlersFor(path);
  router.get(`/${path}`, requireAuth, handlers.list);
  router.get(`/${path}/:id`, requireAuth, handlers.get);
}

// Admin CRUD, mounted under /admin/<entity> from routes/index.js.
export const adminCatalogRouter = Router();
// requireFeature('catalog') — the Team Portal's Catalog Access Feature; only
// ever narrows sales_manager (relationship_manager has no 'catalog' key in
// RM_FEATURE_KEYS, so is 403'd here regardless of its other checkboxes).
adminCatalogRouter.use(requireAuth, requireRole(...STAFF_ROLES), requireFeature('catalog'));

// path -> extra middleware run after toColumns, before the generic
// create/update handler. Only hotels carries occupancy-tiered pricing;
// hotels/tours/activities/transfers each carry their own publish-fields
// gate (0070_hotels_status.sql / 0072_tours_activities_transfers_status.sql)
// — every other entity's pipeline is unchanged.
const EXTRA_MIDDLEWARE = {
  hotels: [deriveHotelPricePerNight, requireHotelPublishFields],
  tours: [requireTourPublishFields],
  activities: [requireActivityPublishFields],
  transfers: [requireTransferPublishFields],
};

for (const { path, schema } of ENTITIES) {
  const handlers = catalogHandlersFor(path);
  const extra = EXTRA_MIDDLEWARE[path] || [];
  adminCatalogRouter.post(`/${path}`, validateBody(schema), toColumns, ...extra, handlers.create);
  adminCatalogRouter.patch(`/${path}/:id`, validateBody(schema.partial()), toColumns, ...extra, handlers.update);
  adminCatalogRouter.delete(`/${path}/:id`, handlers.remove);
}

// Image upload — see uploadImagesHandlerFor doc comment. POST on a distinct
// path (e.g. /admin/hotels/images vs /admin/hotels), so it can't collide
// with the generic create route registered above. Activities already had an
// `images` column (0005_catalog.sql); transfers got one in
// 0029_transfer_images.sql specifically so it could get this same route.
adminCatalogRouter.post('/hotels/images', upload.array('images', 10), uploadImagesHandlerFor('hotels'));
adminCatalogRouter.post('/tours/images', upload.array('images', 10), uploadImagesHandlerFor('tours'));
adminCatalogRouter.post('/activities/images', upload.array('images', 10), uploadImagesHandlerFor('activities'));
adminCatalogRouter.post('/transfers/images', upload.array('images', 10), uploadImagesHandlerFor('transfers'));
// Single-file PDF upload for Content Hub "Oman Overview" — a distinct path
// (not /oman-overviews) for the same collision-avoidance reason as the
// image uploads above, one file (`upload.single`) instead of an array since
// each entry carries exactly one PDF.
adminCatalogRouter.post('/oman-overviews/pdf', upload.single('pdf'), uploadOmanOverviewPdf);
// Single-file image upload for the Deals tab — same one-file convention as
// the PDF route above, field name 'image' instead of 'pdf'.
adminCatalogRouter.post('/deals/image', upload.single('image'), uploadDealImage);

export default router;
