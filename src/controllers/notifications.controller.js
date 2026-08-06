import * as notificationService from '../services/notification.service.js';

// GET /api/notifications?unread=true&limit=&offset=
export async function list(req, res, next) {
  try {
    const { unread, limit, offset } = req.query;
    const notifications = await notificationService.getNotifications(req.user.id, {
      unreadOnly: unread === 'true',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
}

// GET /api/notifications/unread-count
export async function unreadCount(req, res, next) {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/:id/read
export async function markRead(req, res, next) {
  try {
    const notification = await notificationService.markAsRead(req.params.id, req.user.id);
    if (!notification) return res.status(404).json({ error: 'not_found' });
    res.json({ notification });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/read-all
export async function markAllRead(req, res, next) {
  try {
    const updated = await notificationService.markAllAsRead(req.user.id);
    res.json({ updated });
  } catch (err) {
    next(err);
  }
}
