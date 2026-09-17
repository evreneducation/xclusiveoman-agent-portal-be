const {
  Router
} = require('express');

const fdAdmin = require('../controllers/fdPackagesAdmin.controller.js');

const {
  requireAuth,
  requireRole,
  requireFeature,
  STAFF_ROLES
} = require('../middleware/auth.js');

const {
  upload
} = require('../middleware/upload.js');

const {
  validateBody,
  fdPackageSchema,
  fdDepartureDateSchema,
  fdAddonSchema,
  itinerarySchema
} = require('../validation/schemas.js');

const {
  z
} = require('zod');

const router = Router();

// FD Packages are part of the Product Catalog (admin/pages/ProductCatalog.jsx
// groups them together) — same requireFeature('catalog') gate as
// catalog.routes.js's adminCatalogRouter, its own doc comment.
router.use(requireAuth, requireRole(...STAFF_ROLES), requireFeature('catalog'));

router.get('/', fdAdmin.list);
router.get('/:id', fdAdmin.get);
router.post('/', validateBody(fdPackageSchema), fdAdmin.create);
router.patch('/:id', validateBody(fdPackageSchema.partial()), fdAdmin.update);
router.delete('/:id', fdAdmin.remove);
router.post('/:id/hero-image', upload.single('image'), fdAdmin.uploadHeroImage);
router.post('/:id/images', upload.array('images', 10), fdAdmin.uploadImages);
router.delete('/:id/images/:url', fdAdmin.deleteImage);

// Same day/notes/items shape as the Custom FIT itinerary (see
// itinerarySchema in schemas.js) — an FD package's itinerary builder now
// mirrors the agent Custom FIT Builder's per-day hotel/tour/transfer/extra
// pickers instead of a single free-text line per day.
router.put('/:id/itinerary', validateBody(z.object({ days: itinerarySchema })), fdAdmin.putItinerary);

router.post('/:id/departure-dates', validateBody(fdDepartureDateSchema), fdAdmin.postDepartureDate);
router.delete('/:id/departure-dates/:dateId', fdAdmin.deleteDepartureDate);

router.post('/:id/addons', validateBody(fdAddonSchema), fdAdmin.postAddon);
router.delete('/:id/addons/:addonId', fdAdmin.deleteAddon);

module.exports = router;
