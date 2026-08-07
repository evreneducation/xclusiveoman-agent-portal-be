import { Router } from 'express';
import { catalogHandlersFor, uploadImagesHandlerFor } from '../controllers/catalog.controller.js';
import { requireAuth, requireRole, STAFF_ROLES } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import {
  validateBody,
  hotelSchema,
  tourSchema,
  activitySchema,
  transferSchema,
  experienceSchema,
  toSnakeCaseColumns,
} from '../validation/schemas.js';

const router = Router();

function toColumns(req, res, next) {
  req.body = toSnakeCaseColumns(req.body);
  next();
}

const ENTITIES = [
  { path: 'hotels', schema: hotelSchema },
  { path: 'tours', schema: tourSchema },
  { path: 'activities', schema: activitySchema },
  { path: 'transfers', schema: transferSchema },
  { path: 'experiences', schema: experienceSchema },
];

// Public-to-agents listing/detail (doc §12.3) — any authenticated user, agent or staff.
for (const { path } of ENTITIES) {
  const handlers = catalogHandlersFor(path);
  router.get(`/${path}`, requireAuth, handlers.list);
  router.get(`/${path}/:id`, requireAuth, handlers.get);
}

// Admin CRUD, mounted under /admin/<entity> from routes/index.js.
export const adminCatalogRouter = Router();
adminCatalogRouter.use(requireAuth, requireRole(...STAFF_ROLES));

for (const { path, schema } of ENTITIES) {
  const handlers = catalogHandlersFor(path);
  adminCatalogRouter.post(`/${path}`, validateBody(schema), toColumns, handlers.create);
  adminCatalogRouter.patch(`/${path}/:id`, validateBody(schema.partial()), toColumns, handlers.update);
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
