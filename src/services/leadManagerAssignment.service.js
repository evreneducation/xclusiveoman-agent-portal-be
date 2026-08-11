import { pool } from '../db/pool.js';
import { updatePackageRequestLeadManager } from '../models/packageRequestsAdmin.model.js';
import { findUserById } from '../models/users.model.js';
import { insertAuditLog } from '../models/auditLogs.model.js';
import { createNotification } from './notification.service.js';
import { getIo } from '../sockets/index.js';

/**
 * Round-robin Lead Manager assignment for Custom FIT requests: every request
 * gets a Lead Manager the moment it reaches the admin queue
 * (create()/submit() in packageRequests.controller.js) — no manual pick
 * needed, and the pool is restricted to the sales_manager role only, per
 * policy (never any other staff role). The general-purpose "Assign a Lead
 * Manager" admin action (packageRequestsAdmin.controller.js's
 * assignLeadManager) still exists as a manual override, but its own
 * candidate list is filtered to sales_manager too, for the same reason.
 *
 * Same derived-rotation shape as rmAssignment.service.js's
 * pickNextRoundRobinRm — no separate "next in line" pointer table, so it
 * can't drift out of sync with reality on its own.
 */
export async function pickNextRoundRobinLeadManager() {
  const { rows: salesManagers } = await pool.query(
    `SELECT id FROM users WHERE role = 'sales_manager' AND status = 'active' ORDER BY created_at ASC`
  );
  if (salesManagers.length === 0) return null;

  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM package_requests WHERE lead_manager_user_id IS NOT NULL`
  );
  const assignedSoFar = rows[0].n;

  return salesManagers[assignedSoFar % salesManagers.length].id;
}

/**
 * Writes the assignment and fires the same side effects (socket emits,
 * Activity History entry, agent notification) regardless of whether a human
 * admin picked the Lead Manager or the round-robin above did — one place
 * these can't drift apart in what the agent/admin end up seeing.
 * `actorUserId` is left null for an automatic assignment (no admin actually
 * clicked anything — insertAuditLog already tolerates a null actor).
 */
export async function applyLeadManagerAssignment({
  packageRequestId,
  leadManagerUserId,
  previousLeadManagerUserId,
  nextStatus,
  actorUserId,
  destination,
  agencyId,
  createdByUserId,
}) {
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
