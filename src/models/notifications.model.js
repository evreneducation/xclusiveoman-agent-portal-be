import { pool } from '../db/pool.js';

// Raw `notifications` table access (doc §11.8/§12.10) — only the
// NotificationService (services/notification.service.js) calls these; every
// other module goes through the service instead of writing SQL here itself.

export async function insertNotification({
  recipientUserId, recipientRole, type, title, message, referenceType, referenceId,
}) {
  const { rows } = await pool.query(
    `INSERT INTO notifications
      (recipient_user_id, recipient_role, type, title, message, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [recipientUserId, recipientRole || null, type, title, message, referenceType || null, referenceId || null]
  );
  return rows[0];
}

export async function listNotificationsForUser(userId, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const clauses = ['recipient_user_id = $1'];
  const values = [userId];
  if (unreadOnly) clauses.push('is_read = false');

  values.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT * FROM notifications
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return rows;
}

export async function countUnreadForUser(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_user_id = $1 AND is_read = false`,
    [userId]
  );
  return rows[0].count;
}

// Scoped to recipient_user_id so a notification can only ever be marked read
// by the user it belongs to — mirrors mice_rfqs' status-guarded UPDATEs.
export async function markNotificationRead(id, userId) {
  const { rows } = await pool.query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND recipient_user_id = $2 RETURNING *`,
    [id, userId]
  );
  return rows[0] || null;
}

export async function markAllNotificationsRead(userId) {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET is_read = true WHERE recipient_user_id = $1 AND is_read = false`,
    [userId]
  );
  return rowCount;
}

export function toPublicNotification(row) {
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
