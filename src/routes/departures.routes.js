import { Router } from 'express';
import * as departuresController from '../controllers/departures.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, createBookingSchema } from '../validation/schemas.js';

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/', departuresController.listDepartures);
router.get('/:id', departuresController.getDeparture);
// Server-side day-by-day itinerary PDF export (see itineraryPdf.service.js's
// generateFdItineraryPdf) — DepartureDetail.jsx's "Download Itinerary".
router.get('/:id/itinerary.pdf', departuresController.downloadDepartureItineraryPdf);
router.get('/:id/enquire', departuresController.enquireNow);
router.post('/:id/bookings', validateBody(createBookingSchema), departuresController.createBooking);

export default router;
