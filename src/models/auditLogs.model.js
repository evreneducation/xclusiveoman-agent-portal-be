import { pool } from '../db/pool.js';

// Generic, polymorphic activity trail (doc §11.8 / §15 rule 78). `entity` +
// `entity_id` point at any row (currently only 'package_request', for the
// Quote Details "Activity History" timeline) so this one table can back
// other admin screens later without another migration.

export async function insertAuditLog({ actorUserId, entity, entityId, field, oldValue, newValue }) {
  await pool.query(
    `INSERT INTO audit_logs (actor_user_id, entity, entity_id, field, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      actorUserId || null,
      entity,
      entityId,
      field || null,
      oldValue !== undefined ? JSON.stringify(oldValue) : null,
      newValue !== undefined ? JSON.stringify(newValue) : null,
    ]
  );
}

export async function listAuditLogsForEntity(entity, entityId) {
  const { rows } = await pool.query(
    `SELECT al.*, u.full_name AS actor_full_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE al.entity = $1 AND al.entity_id = $2
     ORDER BY al.created_at ASC`,
    [entity, entityId]
  );
  return rows;
}
