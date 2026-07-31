import { Router } from 'express';
import * as bookingsController from '../controllers/bookings.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireRole('agency_owner', 'agency_staff'));

router.get('/', bookingsController.listMyBookings);
router.get('/:id', bookingsController.getBooking);

export default router;
