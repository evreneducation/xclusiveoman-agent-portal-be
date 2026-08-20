import { createNotification } from './notification.service.js';
import { sendEmail } from './email.service.js';
import { getIo } from '../sockets/index.js';
import { listAgencyOwnerEmails } from '../models/users.model.js';
import { listDepartureAgencyIds } from '../models/fdOperations.model.js';

// FD Operations Tracker (Task 12) — driver-dispatch and tour-update
// notifications, fanned out to every agency with a real FD booking on the
// departure (requirement I5). Composes only existing infrastructure:
//   - getIo()?.to(`agency:<id>`).emit(...) — the exact room convention the
//     doc's own WebSocket event spec already uses for booking:status_changed/
//     quote:priced/document:ready/tour:update; no new namespace, just one
//     more event name on the same shared socket connection every other
//     admin-facing real-time update already goes through.
//   - notification.service.js#createNotification — the same `notifications`
//     table + its own `notification:new` (to `user:<id>`) emit + the
//     NotificationBell UI every other in-app notification already uses.
//   - email.service.js#sendEmail — the same Brevo path Marketing Center's
//     own campaigns use.
// Recipient = each agency's active owner (listAgencyOwnerEmails — the same
// "agency-owner lookup" Marketing Center's own send flow already
// established as this app's one definition of "the agency's contact").
//
// Best-effort throughout, matching marketingActivity.service.js's own
// posture: the actual dispatch/update record has already been durably
// written by the time this runs, so a notification/email/socket hiccup
// must never surface as a failure of the action itself. One recipient's
// failure never blocks another's.
async function notifyDepartureAgencies(departureDateId, { socketEvent, socketPayload, notifType, notifTitle, notifMessage, emailSubject, emailBody }) {
  try {
    const agencyIds = await listDepartureAgencyIds(departureDateId);
    if (agencyIds.length === 0) return;

    const io = getIo();
    for (const agencyId of agencyIds) {
      io?.to(`agency:${agencyId}`).emit(socketEvent, socketPayload);
    }

    const owners = await listAgencyOwnerEmails(agencyIds);
    await Promise.all(
      owners.map(async (owner) => {
        try {
          await createNotification({
            recipientUserId: owner.id,
            recipientRole: 'agency_owner',
            type: notifType,
            title: notifTitle,
            message: notifMessage,
            referenceType: 'fd_departure',
            referenceId: departureDateId,
          });
        } catch (err) {
          console.error(`[fdOperationsNotify] Failed to notify user ${owner.id}`, err);
        }
        try {
          await sendEmail({ to: owner.email, subject: emailSubject, text: emailBody });
        } catch (err) {
          console.error(`[fdOperationsNotify] Failed to email ${owner.email}`, err);
        }
      })
    );
  } catch (err) {
    console.error(`[fdOperationsNotify] Failed to fan out for departure ${departureDateId}`, err);
  }
}

// OPS-3 — driver/pickup dispatch. No dedicated doc-named socket event
// exists for this (unlike tour:update below), so this follows the same
// `noun:verb` naming style the doc's own events already use
// (lead:assigned, document:ready).
export async function notifyDriverDispatched(departureDateId, { packageTitle, driverName, vehicle, pickupDetails }) {
  const message = `${packageTitle} — driver ${driverName} (${vehicle}), pickup: ${pickupDetails}`;
  await notifyDepartureAgencies(departureDateId, {
    socketEvent: 'driver:dispatched',
    socketPayload: { fdDepartureDateId: departureDateId, driverName, vehicle, pickupDetails },
    notifType: 'fd_driver_dispatched',
    notifTitle: 'Driver & pickup details sent',
    notifMessage: message,
    emailSubject: `Driver & pickup details — ${packageTitle}`,
    emailBody: `Driver and pickup details for ${packageTitle}:\n\nDriver: ${driverName}\nVehicle: ${vehicle}\nPickup: ${pickupDetails}`,
  });
}

// OPS-4 — tour update broadcast. `tour:update` is the doc's own named event
// for this exact purpose (§13 WebSocket Event Spec) — reused verbatim, not
// invented here.
export async function notifyTourUpdatePublished(departureDateId, { packageTitle, updateType, message }) {
  await notifyDepartureAgencies(departureDateId, {
    socketEvent: 'tour:update',
    socketPayload: { fdDepartureDateId: departureDateId, updateType, message },
    notifType: 'fd_tour_update',
    notifTitle: 'Tour update',
    notifMessage: `${packageTitle} — ${message}`,
    emailSubject: `Tour update — ${packageTitle}`,
    emailBody: `An update was published for ${packageTitle}:\n\n${message}`,
  });
}
