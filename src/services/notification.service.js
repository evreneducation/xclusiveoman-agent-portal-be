const {
  insertNotification,
  listNotificationsForUser,
  countUnreadForUser,
  markNotificationRead,
  markAllNotificationsRead,
  toPublicNotification
} = require('../models/notifications.model.js');

const {
  getIo
} = require('../sockets/index.js');

async function createNotification(
  {
    recipientUserId, recipientRole, type, title, message, referenceType, referenceId,
  }
) {
  if (!recipientUserId) throw new Error('createNotification requires recipientUserId');
  if (!type || !title || !message) throw new Error('createNotification requires type, title and message');

  const row = await insertNotification({
    recipientUserId, recipientRole, type, title, message, referenceType, referenceId,
  });
  const notification = toPublicNotification(row);

  getIo()?.to(`user:${recipientUserId}`).emit('notification:new', notification);

  return notification;
}

module.exports.createNotification = createNotification;

async function getNotifications(userId, { unreadOnly, limit, offset } = {}) {
  const rows = await listNotificationsForUser(userId, { unreadOnly, limit, offset });
  return rows.map(toPublicNotification);
}

module.exports.getNotifications = getNotifications;

async function getUnreadCount(userId) {
  return countUnreadForUser(userId);
}

module.exports.getUnreadCount = getUnreadCount;

async function markAsRead(id, userId) {
  const row = await markNotificationRead(id, userId);
  return toPublicNotification(row);
}

module.exports.markAsRead = markAsRead;

async function markAllAsRead(userId) {
  return markAllNotificationsRead(userId);
}

module.exports.markAllAsRead = markAllAsRead;
