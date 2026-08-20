import { Router } from 'express';
import { catalogHandlersFor, uploadImagesHandlerFor } from '../controllers/catalog.controller.js';
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

for (const { path, schema } of ENTITIES) {
  const handlers = catalogHandlersFor(path);
  // Only 'hotels' carries occupancy-tiered pricing — every other entity's
  // pipeline is unchanged.
  const extra = path === 'hotels' ? [deriveHotelPricePerNight] : [];
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

export default router;
