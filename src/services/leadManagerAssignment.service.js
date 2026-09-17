const {
  pool
} = require('../db/pool.js');

const {
  updatePackageRequestLeadManager
} = require('../models/packageRequestsAdmin.model.js');

const {
  findUserById
} = require('../models/users.model.js');

const {
  insertAuditLog
} = require('../models/auditLogs.model.js');

const {
  createNotification
} = require('./notification.service.js');

const {
  getIo
} = require('../sockets/index.js');

async function pickNextRoundRobinLeadManager() {
  const { rows: salesManagers } = await pool.query(
    `SELECT id FROM users WHERE role = 'sales_manager' AND status = 'active' ORDER BY created_at ASC`
  );
  if (salesManagers.length === 0) return null;

  // Postgres' `count(*)::int` cast dropped — MySQL's COUNT(*) already
  // comes back as a plain number, no cast needed/available.
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS n FROM package_requests WHERE lead_manager_user_id IS NOT NULL`
  );
  const assignedSoFar = rows[0].n;

  return salesManagers[assignedSoFar % salesManagers.length].id;
}

module.exports.pickNextRoundRobinLeadManager = pickNextRoundRobinLeadManager;

async function applyLeadManagerAssignment(
  {
    packageRequestId,
    leadManagerUserId,
    previousLeadManagerUserId,
    nextStatus,
    actorUserId,
    destination,
    agencyId,
    createdByUserId,
  }
) {
  await updatePackageRequestLeadManager(packageRequestId, leadManagerUserId, nextStatus);

  // doc §13: lead:assigned -> staff (assigned user).
  getIo()?.to(`user:${leadManagerUserId}`).emit('lead:assigned', { packageRequestId, destination });
  // Agent Quote lifecycle (item 7) — same event/room the agent's "My FIT
  // Requests" list already listens on, so status updates land live instead
  // of on next page load.
  getIo()?.to(`agency:${agencyId}`).emit('quote:status_changed', { packageRequestId, status: nextStatus });

  await insertAuditLog({
    actorUserId: actorUserId || null,
    entity: 'package_request',
    entityId: packageRequestId,
    field: 'lead_manager_user_id',
    oldValue: { leadManagerUserId: previousLeadManagerUserId ?? null },
    newValue: { leadManagerUserId },
  });

  const leadManager = await findUserById(leadManagerUserId);
  await createNotification({
    recipientUserId: createdByUserId,
    type: 'fit_lead_manager_assigned',
    title: 'Lead Manager assigned',
    message: `${leadManager?.full_name || 'A Lead Manager'} has been assigned as your Lead Manager for the FIT request to ${destination}.`,
    referenceType: 'package_request',
    referenceId: packageRequestId,
  });
}

module.exports.applyLeadManagerAssignment = applyLeadManagerAssignment;
