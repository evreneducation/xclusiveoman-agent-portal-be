import { Router } from 'express';
import * as locationsController from '../controllers/locations.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, locationsController.list);

export default router;
