const {
  Router
} = require('express');

const departuresController = require('../controllers/departures.controller.js');

const {
  requireAuth,
  requireRole
} = require('../middleware/auth.js');

const {
  validateBody,
  createBookingSchema
} = require('../validation/schemas.js');

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/', departuresController.listDepartures);
router.get('/:id', departuresController.getDeparture);
// Server-side day-by-day itinerary PDF export (see itineraryPdf.service.js's
// generateFdItineraryPdf) — DepartureDetail.jsx's "Download Itinerary".
router.get('/:id/itinerary.pdf', departuresController.downloadDepartureItineraryPdf);
router.get('/:id/enquire', departuresController.enquireNow);
router.post('/:id/bookings', validateBody(createBookingSchema), departuresController.createBooking);

module.exports = router;
