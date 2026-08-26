import { Router } from 'express';
import { getDepartureDataForPdf } from '../controllers/departures.controller.js';
import { requireFdPdfToken } from '../middleware/auth.js';

// Same "separate router/mount, separate auth" reasoning as
// itineraryPdfData.routes.js: departures.routes.js's requireAuth expects a
// real login session's Bearer token, which the Puppeteer-rendered print page
// (agent/pages/DepartureItineraryPrint.jsx) never has — it authenticates
// with the short-lived FD pdfToken instead (requireFdPdfToken), scoped to
// exactly the one departure it's rendering. See itineraryPdf.service.js's
// generateFdItineraryPdf for the full flow this endpoint is part of.
const router = Router();

router.use(requireFdPdfToken);
router.get('/:id/data', getDepartureDataForPdf);

export default router;
