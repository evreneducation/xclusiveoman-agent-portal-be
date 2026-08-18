import { createNotification } from './notification.service.js';
import { sendEmail } from './email.service.js';
import { getIo } from '../sockets/index.js';
import { findUserById } from '../models/users.model.js';

// Admin Support & Helpdesk (Task 18) — SUP-3 "Both sides can reply; triggers
// a notification to the other side", §14.5 "Support ticket reply -> Yes
// (in-app) + Yes (email) -- whichever side didn't send it". Composes only
// existing infrastructure (notification.service.js#createNotification,
// email.service.js#sendEmail, the doc's own §13 room convention) — no new
// notification mechanism, matching every prior task's own posture.
//
// Doc §13's own WebSocket Event Spec names the target for `ticket:new_message`
// as "agency:<id> or staff" — literally the room to ping, not necessarily
// who gets the persisted/email notification. Those two are handled
// separately here: the broad room ping is for whoever's already watching
// live; the persisted notification + email always goes to one specific
// person (the assignee, or the ticket's own creator) so it's never lost if
// nobody was online.

async function notifyBestEffort({ recipientUserId, type, title, message, referenceId }) {
  if (!recipientUserId) return; // nothing to notify (e.g. ticket not yet assigned)
  // One lookup, reused for both the notification's role snapshot and the
  // email address — avoids hardcoding/guessing a role that might not match
  // (the creator could be agency_owner or agency_staff; the assignee is
  // always support/super_admin, but why hardcode either).
  const recipient = await findUserById(recipientUserId).catch(() => null);
  try {
    await createNotification({
      recipientUserId,
      recipientRole: recipient?.role || null,
      type,
      title,
      message,
      referenceType: 'support_ticket',
      referenceId,
    });
  } catch (err) {
    console.error(`[supportTicketNotify] Failed to notify user ${recipientUserId}`, err);
  }
  try {
    if (recipient) {
      await sendEmail({ to: recipient.email, subject: title, text: message });
    }
  } catch (err) {
    console.error(`[supportTicketNotify] Failed to email user ${recipientUserId}`, err);
  }
}

// Agent replied -> ping the staff room live, and (if assigned) persist +
// email the assigned staff member specifically.
export async function notifyStaffOfReply(ticket, { senderName, messagePreview }) {
  try {
    getIo()?.to('staff').emit('ticket:new_message', { ticketId: ticket.id, subject: ticket.subject, from: 'agency' });
    await notifyBestEffort({
      recipientUserId: ticket.assigned_to_user_id,
      type: 'ticket_reply',
      title: `New reply on ticket: ${ticket.subject}`,
      message: `${senderName} replied: "${messagePreview}"`,
      referenceId: ticket.id,
    });
  } catch (err) {
    console.error(`[supportTicketNotify] Failed to notify staff for ticket ${ticket.id}`, err);
  }
}

// Staff replied -> ping the agency room live, and persist + email the
// ticket's own creator (always exists, unlike an assignee).
export async function notifyAgencyOfReply(ticket, { senderName, messagePreview }) {
  try {
    getIo()?.to(`agency:${ticket.agency_id}`).emit('ticket:new_message', { ticketId: ticket.id, subject: ticket.subject, from: 'staff' });
    await notifyBestEffort({
      recipientUserId: ticket.created_by_user_id,
      type: 'ticket_reply',
      title: `New reply on your ticket: ${ticket.subject}`,
      message: `${senderName} replied: "${messagePreview}"`,
      referenceId: ticket.id,
    });
  } catch (err) {
    console.error(`[supportTicketNotify] Failed to notify agency for ticket ${ticket.id}`, err);
  }
}
