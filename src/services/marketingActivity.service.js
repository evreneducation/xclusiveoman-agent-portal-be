import { insertAuditLog } from '../models/auditLogs.model.js';
import { createNotification } from './notification.service.js';
import { listStaffByRole } from '../models/users.model.js';

// Marketing Center Task 8 — Admin Activity + in-app Notifications for
// campaign lifecycle events. Deliberately NOT a new notification system:
// this only composes the two generic systems that already exist in this
// backend —
//
//   1. audit_logs (entity/entity_id) — the same polymorphic table Quote
//      Details' and MICE Request Detail's own "Activity History" timelines
//      already read via listAuditLogsForEntity(). Its own migration
//      comment (0021_package_request_costing.sql) says it exists to "back
//      ... other admin screens later without another migration per
//      entity" — this is exactly that.
//   2. notifications (services/notification.service.js's createNotification)
//      — the same `notifications` table, `notification:new` socket emit,
//      and NotificationBell UI every other admin notification already goes
//      through. createNotification is single-recipient by design, so
//      "notify the marketing team" means looping it once per admin, the
//      same pattern auth.controller.js#notifyAdminsOfNewAgent already
//      established for "New Agent Added" (broadcast to every active admin
//      in the domain-owning role(s), not a new broadcast primitive).
//
// entity = 'marketing_campaign' (singular, matching the package_request/
// mice_rfq convention — the table itself is marketing_campaigns). field =
// the lifecycle event itself ('scheduled'/'sent'/'partially_failed'/
// 'failed'/'cancelled'), the same way 'draft_saved'/'submitted'/
// 'agent_response' name a lifecycle moment rather than a raw column name.
const EVENT_META = {
  scheduled: {
    field: 'scheduled',
    label: 'scheduled',
    notifType: 'marketing_campaign_scheduled',
    notifTitle: 'Campaign Scheduled',
  },
  sent: {
    field: 'sent',
    label: 'sent',
    notifType: 'marketing_campaign_sent',
    notifTitle: 'Campaign Sent',
    priorStatus: 'sending',
  },
  partially_failed: {
    field: 'partially_failed',
    label: 'partially failed',
    notifType: 'marketing_campaign_partially_failed',
    notifTitle: 'Campaign Partially Failed',
    priorStatus: 'sending',
  },
  failed: {
    field: 'failed',
    label: 'failed',
    notifType: 'marketing_campaign_failed',
    notifTitle: 'Campaign Failed',
    priorStatus: 'sending',
  },
  cancelled: {
    field: 'cancelled',
    label: 'cancelled',
    notifType: 'marketing_campaign_cancelled',
    notifTitle: 'Campaign Cancelled',
    priorStatus: 'scheduled',
  },
};

// Same role pool Marketing's own RBAC gate uses (marketing.routes.js —
// requireRole('sales_marketing', 'super_admin')): whoever can act on
// campaigns is who gets told about them.
async function notifyMarketingStaff({ type, title, message, referenceId }) {
  const [salesMarketing, superAdmins] = await Promise.all([
    listStaffByRole('sales_marketing'),
    listStaffByRole('super_admin'),
  ]);
  const staff = [...salesMarketing, ...superAdmins].filter((u) => u.status === 'active');

  await Promise.all(
    staff.map((u) =>
      createNotification({
        recipientUserId: u.id,
        recipientRole: u.role,
        type,
        title,
        message,
        referenceType: 'marketing_campaign',
        referenceId,
      })
    )
  );
}

// Called from exactly one place per event today —
// marketing.controller.js#scheduleCampaign (scheduled), #cancelCampaign
// (cancelled), and marketingSend.service.js#executeCampaignSend
// (sent/partially_failed/failed, the single function both the send-now and
// scheduled-send paths call) — each sitting at a state transition the
// database itself only ever lets happen once for a given campaign id:
//   - executeCampaignSend only runs once per campaign (send-now calls it
//     synchronously right after creation; the scheduler only ever claims a
//     campaign via `UPDATE ... WHERE status = 'scheduled' ... FOR UPDATE
//     SKIP LOCKED`, so an overlapping poll tick or a restart can never
//     claim — and therefore never re-execute — the same row twice).
//   - cancelScheduledCampaign's `WHERE status = 'scheduled'` guard means a
//     second cancel attempt on an already-cancelled/already-sending
//     campaign returns no row, and the controller below only calls this
//     when a row actually came back.
//   - scheduleCampaign only calls this once, right after the one INSERT
//     that creates the campaign.
// So no separate duplicate-detection key (e.g. a
// `marketing_campaign:<id>:<event>` unique constraint) is needed — the
// existing atomic state-transition guarantees already are the dedupe
// mechanism, per the same "use the existing database/state transition
// pattern" this table's other callers (e.g. leadManagerAssignment.service.js)
// already rely on instead of inventing idempotency keys of their own.
//
// Best-effort: never throws. The campaign's own state change has always
// already succeeded and been durably committed by the time this runs — the
// same "a notification hiccup must never fail the action" posture
// notifyAdminsOfNewAgent takes toward registration.
export async function recordCampaignEvent(event, campaign, { actorUserId } = {}) {
  const meta = EVENT_META[event];
  if (!meta || !campaign) return;

  try {
    const description = `Marketing campaign ${meta.label} — ${campaign.name}`;

    await insertAuditLog({
      actorUserId: actorUserId || campaign.created_by_user_id || null,
      entity: 'marketing_campaign',
      entityId: campaign.id,
      field: meta.field,
      oldValue: meta.priorStatus ? { status: meta.priorStatus } : undefined,
      newValue: {
        description,
        name: campaign.name,
        channel: campaign.channel,
        provider: campaign.provider,
        audienceType: campaign.audience_type,
        audienceValue: campaign.audience_value,
        status: campaign.status,
        recipientCount: campaign.recipient_count,
        successCount: campaign.success_count,
        failureCount: campaign.failure_count,
        scheduledAt: campaign.scheduled_at,
        sentAt: campaign.sent_at,
      },
    });

    await notifyMarketingStaff({
      type: meta.notifType,
      title: meta.notifTitle,
      message: description,
      referenceId: campaign.id,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[marketingActivity] Failed to record "${event}" event for campaign ${campaign.id}`, err);
  }
}
