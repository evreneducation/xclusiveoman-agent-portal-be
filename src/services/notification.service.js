import {
  insertNotification,
  listNotificationsForUser,
  countUnreadForUser,
  markNotificationRead,
  markAllNotificationsRead,
  toPublicNotification,
} from '../models/notifications.model.js';
import { getIo } from '../sockets/index.js';

/**
 * Generic, reusable notification infrastructure (doc §11.8/§12.10/§13).
 * Every business module (FIT, MICE, bookings, payments, …) creates
 * notifications through this service instead of writing `notifications`
 * SQL or socket emits of its own — this is the one place that does both,
 * so the row and the real-time push can never drift apart.
 *
 * Task 1 scope: infrastructure only — no business module calls
 * createNotification() yet (that starts in a later task).
 */

// { recipientUserId, recipientRole?, type, title, message, referenceType?, referenceId? }
// Emits notification:new to room user:<recipientUserId> (doc §13) after the
// row is durably written, so a missed socket delivery never loses the
// notification — the recipient still finds it via getNotifications().
export async function createNotification({
  recipientUserId, recipientRole, type, title, message, referenceType, referenceId,
}) {
  if (!recipientUserId) throw new Error('createNotification requires recipientUserId');
  if (!type || !title || !message) throw new Error('createNotification requires type, title and message');

  const row = await insertNotification({
    recipientUserId, recipientRole, type, title, message, referenceType, referenceId,
  });
  const notification = toPublicNotification(row);

  getIo()?.to(`user:${recipientUserId}`).emit('notification:new', notification);

  return notification;
}

// userId is always the authenticated caller — this service never lets one
// user page through another user's notifications.
export async function getNotifications(userId, { unreadOnly, limit, offset } = {}) {
  const rows = await listNotificationsForUser(userId, { unreadOnly, limit, offset });
  return rows.map(toPublicNotification);
}

export async function getUnreadCount(userId) {
  return countUnreadForUser(userId);
}

export async function markAsRead(id, userId) {
  const row = await markNotificationRead(id, userId);
  return toPublicNotification(row);
}

export async function markAllAsRead(userId) {
  return markAllNotificationsRead(userId);
}
