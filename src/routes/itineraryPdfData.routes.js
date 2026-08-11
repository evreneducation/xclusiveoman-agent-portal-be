import { Router } from 'express';
import { getItineraryDataForPdf } from '../controllers/packageRequests.controller.js';
import { requirePdfToken } from '../middleware/auth.js';

// Deliberately a separate router/mount from packageRequests.routes.js: that
// router's requireAuth expects a real login session's Bearer token, which
// the Puppeteer-rendered print page (agent/pages/ItineraryPrint.jsx) never
// has — it authenticates with the short-lived pdfToken instead
// (requirePdfToken), scoped to exactly the one itinerary it's rendering. See
// itineraryPdf.service.js for the full flow this endpoint is part of.
const router = Router();

router.use(requirePdfToken);
router.get('/:id/data', getItineraryDataForPdf);

export default router;
