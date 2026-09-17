const {
  pool
} = require('../db/pool.js');

const {
  newId
} = require('../utils/id.js');

async function insertAuditLog({ actorUserId, entity, entityId, field, oldValue, newValue }) {
  await pool.query(
    `INSERT INTO audit_logs (id, actor_user_id, entity, entity_id, field, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      actorUserId || null,
      entity,
      entityId,
      field || null,
      oldValue !== undefined ? JSON.stringify(oldValue) : null,
      newValue !== undefined ? JSON.stringify(newValue) : null,
    ]
  );
}

module.exports.insertAuditLog = insertAuditLog;

async function listAuditLogsForEntity(entity, entityId) {
  const { rows } = await pool.query(
    `SELECT al.*, u.full_name AS actor_full_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE al.entity = ? AND al.entity_id = ?
     ORDER BY al.created_at ASC`,
    [entity, entityId]
  );
  return rows;
}

module.exports.listAuditLogsForEntity = listAuditLogsForEntity;
