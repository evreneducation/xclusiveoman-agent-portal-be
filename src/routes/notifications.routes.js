import { Router } from 'express';
import * as notificationsController from '../controllers/notifications.controller.js';
import { requireAuth } from '../middleware/auth.js';

// Any authenticated user (agent or staff) has their own notification feed —
// no role gate, unlike the /admin/* routers (doc §12.10).
const router = Router();
router.use(requireAuth);

router.get('/', notificationsController.list);
router.get('/unread-count', notificationsController.unreadCount);
router.patch('/read-all', notificationsController.markAllRead);
router.patch('/:id/read', notificationsController.markRead);

export default router;
