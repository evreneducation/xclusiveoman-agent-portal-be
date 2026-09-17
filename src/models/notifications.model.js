const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function insertNotification(
  {
    recipientUserId, recipientRole, type, title, message, referenceType, referenceId,
  }
) {
  const id = newId();
  await pool.query(
    `INSERT INTO notifications
      (id, recipient_user_id, recipient_role, type, title, message, reference_type, reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, recipientUserId, recipientRole || null, type, title, message, referenceType || null, referenceId || null]
  );
  const { rows } = await pool.query('SELECT * FROM notifications WHERE id = ?', [id]);
  return rows[0];
}

module.exports.insertNotification = insertNotification;

async function listNotificationsForUser(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const clauses = ['recipient_user_id = ?'];
  const values = [userId];
  if (unreadOnly) clauses.push('is_read = false');

  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT * FROM notifications
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    values
  );
  return rows;
}

module.exports.listNotificationsForUser = listNotificationsForUser;

async function countUnreadForUser(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM notifications WHERE recipient_user_id = ? AND is_read = false`,
    [userId]
  );
  return rows[0].count;
}

module.exports.countUnreadForUser = countUnreadForUser;

async function markNotificationRead(id, userId) {
  await pool.query(
    `UPDATE notifications SET is_read = true WHERE id = ? AND recipient_user_id = ?`,
    [id, userId]
  );
  // Same WHERE clause as the UPDATE — safe to reuse here (unlike the
  // guarded transitions in payments.model.js/fdOperations.model.js) since
  // neither `id` nor `recipient_user_id` is a column this UPDATE touches,
  // so a row that matched the guard before the write still matches it
  // after.
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE id = ? AND recipient_user_id = ?`,
    [id, userId]
  );
  return rows[0] || null;
}

module.exports.markNotificationRead = markNotificationRead;

async function markAllNotificationsRead(userId) {
  // No RETURNING here in the original — this needs an actual affected-row
  // count, not just "did it match". src/db/pool.js's adapter normalizes
  // mysql2's ResultSetHeader.affectedRows into `rowCount`, the same field pg
  // used to return.
  const { rowCount } = await pool.query(
    `UPDATE notifications SET is_read = true WHERE recipient_user_id = ? AND is_read = false`,
    [userId]
  );
  return rowCount;
}

module.exports.markAllNotificationsRead = markAllNotificationsRead;

function toPublicNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipientUserId: row.recipient_user_id,
    recipientRole: row.recipient_role,
    type: row.type,
    title: row.title,
    message: row.message,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

module.exports.toPublicNotification = toPublicNotification;
