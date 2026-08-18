import {
  listTicketsForAdmin,
  findTicketForAdmin,
  updateTicketAssignmentAndStatus,
  insertTicketMessage,
  listMessagesForTicket,
} from '../models/supportTickets.model.js';
import { listStaffByRole, toPublicUser, findUserById } from '../models/users.model.js';
import { insertAuditLog, listAuditLogsForEntity } from '../models/auditLogs.model.js';
import { notifyAgencyOfReply } from '../services/supportTicketNotify.service.js';

// Admin Support & Helpdesk (Task 18 — SUP-2/SUP-3). Mounted at
// /api/admin/support/tickets, gated requireRole('support','super_admin') —
// its own RBAC boundary, independent of Marketing/Operations/Manual
// Booking/Documents/Payments, same convention every prior admin feature in
// this codebase established.
//
// Two endpoints here (GET .../:id detail, POST .../:id/messages) go beyond
// the doc's own bare 2-route bullet list for this section — both are
// necessary for the explicitly-required "threaded replies" and "activity
// history" admin UI to function at all, and mirror this codebase's own
// established pattern of a mirrored admin reply/detail endpoint alongside
// the agent one (e.g. booking creation: self-service vs
// /admin/bookings/manual, both funneling into one shared model layer).

function toPublicMessage(m) {
  return {
    id: m.id,
    senderUserId: m.sender_user_id,
    senderName: m.sender_name,
    senderRole: m.sender_role,
    message: m.message,
    createdAt: m.created_at,
  };
}

function toPublicTicket(t) {
  return {
    id: t.id,
    agencyId: t.agency_id,
    agencyName: t.agency_name,
    createdByUserId: t.created_by_user_id,
    createdByName: t.created_by_name,
    createdByEmail: t.created_by_email,
    subject: t.subject,
    description: t.description,
    priority: t.priority,
    status: t.status,
    assignedToUserId: t.assigned_to_user_id,
    assignedToName: t.assigned_to_name,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// Merges audit_logs (assignment/status changes) with ticket_messages
// (replies) into one chronological feed — same pattern
// fdOperationsAdmin.controller.js#buildActivityHistory established (Task 12):
// each source already durably records itself, this just reads them back
// together.
function buildActivityHistory({ auditLogs, messages }) {
  const items = [];
  for (const log of auditLogs) {
    const label = log.field === 'assigned_to_user_id' ? 'Assignment changed' : log.field === 'status' ? 'Status changed' : 'Ticket updated';
    const detail = log.new_value?.assignedToName ? ` — assigned to ${log.new_value.assignedToName}` : log.new_value?.status ? ` — ${log.new_value.status.replace(/_/g, ' ')}` : '';
    items.push({ type: 'activity', description: `${label}${detail}`, at: log.created_at, by: log.actor_full_name || null });
  }
  for (const m of messages) {
    items.push({ type: 'message', description: `Reply — "${m.message.slice(0, 80)}${m.message.length > 80 ? '…' : ''}"`, at: m.created_at, by: m.sender_name });
  }
  return items.sort((a, b) => new Date(a.at) - new Date(b.at));
}

// GET /api/admin/support/tickets/assignment-candidates — support-role staff
// + super_admin only (Task 18 scope decision), same "narrow, policy-defined
// pool" reasoning as packageRequestsAdmin's own Lead Manager candidates
// (Sales Managers only).
export async function listAssignmentCandidates(req, res, next) {
  try {
    const [support, superAdmins] = await Promise.all([listStaffByRole('support'), listStaffByRole('super_admin')]);
    res.json({ staff: [...support, ...superAdmins].map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/support/tickets?status=&priority=&assignedToUserId=&search=&page=&pageSize=
export async function listTickets(req, res, next) {
  try {
    const { status, priority, assignedToUserId, search, page, pageSize } = req.query;
    const { rows, total, page: currentPage, pageSize: limit } = await listTicketsForAdmin({
      status,
      priority,
      assignedToUserId,
      search,
      page,
      pageSize,
    });

    res.json({
      tickets: rows.map(toPublicTicket),
      pagination: { total, page: currentPage, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/support/tickets/:id
export async function getTicket(req, res, next) {
  try {
    const ticket = await findTicketForAdmin(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found' });

    const [messages, auditLogs] = await Promise.all([
      listMessagesForTicket(ticket.id),
      listAuditLogsForEntity('support_ticket', ticket.id),
    ]);

    res.json({
      ticket: toPublicTicket(ticket),
      messages: messages.map(toPublicMessage),
      activity: buildActivityHistory({ auditLogs, messages }),
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/support/tickets/:id — assign and/or change status.
// Each provided field gets its own audit_logs entry (Task 18: "Audit
// assignment and status changes"), matching Task 12's own one-entry-per-
// real-change convention rather than one lumped entry.
export async function updateTicket(req, res, next) {
  try {
    const existing = await findTicketForAdmin(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const { status, assignedToUserId } = req.body;

    // Assignment candidates are policy-restricted (support-role + super_admin
    // only) — re-verified server-side, never trusting the client to only
    // ever offer the restricted dropdown.
    if (assignedToUserId) {
      const [support, superAdmins] = await Promise.all([listStaffByRole('support'), listStaffByRole('super_admin')]);
      const allowedIds = new Set([...support, ...superAdmins].map((u) => u.id));
      if (!allowedIds.has(assignedToUserId)) {
        return res.status(400).json({ error: 'invalid_assignee', message: 'Tickets can only be assigned to support staff or a super admin.' });
      }
    }

    await updateTicketAssignmentAndStatus(req.params.id, { status, assignedToUserId });

    if (assignedToUserId !== undefined && assignedToUserId !== existing.assigned_to_user_id) {
      const assignee = assignedToUserId ? await findUserById(assignedToUserId) : null;
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'support_ticket',
        entityId: existing.id,
        field: 'assigned_to_user_id',
        oldValue: { assignedToUserId: existing.assigned_to_user_id },
        newValue: { assignedToUserId, assignedToName: assignee?.full_name || null },
      });
    }
    if (status && status !== existing.status) {
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'support_ticket',
        entityId: existing.id,
        field: 'status',
        oldValue: { status: existing.status },
        newValue: { status },
      });
    }

    // Re-fetch (rather than merge the raw updateTicketAssignmentAndStatus
    // row into `existing`) so agency_name/created_by_*/assigned_to_name are
    // never stale after a reassignment — the joined display fields have to
    // come from the same query that resolves the new assignee's name.
    const fresh = await findTicketForAdmin(existing.id);
    res.json({ ticket: toPublicTicket(fresh) });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/support/tickets/:id/messages — SUP-3, staff side.
export async function replyToTicket(req, res, next) {
  try {
    const ticket = await findTicketForAdmin(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'not_found' });

    const message = await insertTicketMessage({ ticketId: ticket.id, senderUserId: req.user.id, message: req.body.message });

    await notifyAgencyOfReply(ticket, { senderName: req.user.full_name, messagePreview: req.body.message.slice(0, 140) });

    res.status(201).json({ message: toPublicMessage({ ...message, sender_name: req.user.full_name, sender_role: req.user.role }) });
  } catch (err) {
    next(err);
  }
}
