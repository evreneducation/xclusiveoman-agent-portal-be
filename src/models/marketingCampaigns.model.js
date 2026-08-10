import { pool } from '../db/pool.js';
import { listAgencies } from './agencies.model.js';

// Marketing Center Task 5 — Send Campaign persistence + the server's own,
// independent audience resolution (never trusts a frontend-supplied
// recipient list/count — marketing.controller.js only ever passes through
// `audienceType`/`audienceValue` as *intent*).
//
// "Eligible" always means status = 'approved' — pending/rejected/suspended
// agencies are never real send targets, same rule the Task 3 UI's Audience
// card counts already apply. Mirrors that same four-segment mapping exactly
// (all / by tier / by country / inactive 30+ days) so the count an admin
// saw before confirming a send can never come back different here.
const INACTIVE_SINCE_DAYS = 30;

export async function resolveAudience({ audienceType, audienceValue }) {
  if (audienceType === 'tier') {
    return listAgencies({ status: 'approved', tier: audienceValue });
  }
  if (audienceType === 'country') {
    return listAgencies({ status: 'approved', country: audienceValue });
  }
  if (audienceType === 'inactive_30d') {
    return listAgencies({ status: 'approved', inactiveSinceDays: INACTIVE_SINCE_DAYS });
  }
  // 'all'
  return listAgencies({ status: 'approved' });
}

// `status` is 'sending' for an immediate Send Campaign (Task 5) or
// 'scheduled' for Schedule Campaign (Task 6), with `scheduledAt` (a UTC
// Date, already converted from the admin's zoned input — see
// utils/timezone.js) set only in the latter case.
export async function createCampaign(client, {
  name, channel, provider, audienceType, audienceValue, subject, body,
  replyToAccountManager, recipientCount, createdByUserId, status, scheduledAt,
}) {
  const { rows } = await client.query(
    `INSERT INTO marketing_campaigns
      (name, channel, provider, audience_type, audience_value, subject, body,
       reply_to_account_manager, status, recipient_count, created_by_user_id, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      name, channel, provider, audienceType, audienceValue || null, subject || null, body,
      !!replyToAccountManager, status, recipientCount, createdByUserId, scheduledAt || null,
    ]
  );
  return rows[0];
}

export async function findCampaignById(id) {
  const { rows } = await pool.query('SELECT * FROM marketing_campaigns WHERE id = $1', [id]);
  return rows[0] || null;
}

// The recipient rows an earlier createCampaign/insertRecipients call already
// wrote — executeCampaignSend (services/marketingSend.service.js) reads
// these back rather than being handed them as an in-memory argument, so it
// works identically whether it's called right after insertion (send-now) or
// much later by the scheduler job, in a different request/process entirely.
export async function listRecipientsByCampaign(campaignId) {
  const { rows } = await pool.query(
    `SELECT * FROM marketing_campaign_recipients WHERE campaign_id = $1 ORDER BY created_at`,
    [campaignId]
  );
  return rows;
}

// Cancel Schedule (Task 6) — the `AND status = 'scheduled'` guard is what
// actually enforces "only works for campaigns still in scheduled state":
// it's atomic and race-safe (a campaign the scheduler job has *just*
// claimed, flipping it to 'sending', simply won't match this WHERE clause
// anymore — no separate check-then-update window for the two to race in).
export async function cancelScheduledCampaign(id) {
  const { rows } = await pool.query(
    `UPDATE marketing_campaigns SET status = 'cancelled', updated_at = now()
     WHERE id = $1 AND status = 'scheduled'
     RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

// Inserted as 'pending' up front (within the same transaction as the
// campaign row) so the full intended recipient set is durable before any
// actual send attempt starts — a crash mid-send still leaves an accurate
// "who was supposed to get this" record, not just whoever happened to
// succeed first.
export async function insertRecipients(client, campaignId, recipients) {
  const rows = [];
  for (const r of recipients) {
    const { rows: inserted } = await client.query(
      `INSERT INTO marketing_campaign_recipients (campaign_id, agency_id, channel, recipient_address, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [campaignId, r.agencyId, r.channel, r.recipientAddress]
    );
    rows.push(inserted[0]);
  }
  return rows;
}

export async function markRecipientSent(recipientId, { providerMessageId } = {}) {
  await pool.query(
    `UPDATE marketing_campaign_recipients SET status = 'sent', provider_message_id = $2, sent_at = now() WHERE id = $1`,
    [recipientId, providerMessageId || null]
  );
}

export async function markRecipientFailed(recipientId, failureReason) {
  await pool.query(
    `UPDATE marketing_campaign_recipients SET status = 'failed', failure_reason = $2 WHERE id = $1`,
    [recipientId, failureReason || null]
  );
}

// Final rollup once every recipient has been attempted (or the whole
// campaign was rejected up front, e.g. provider not configured — same
// function either way, just successCount === 0 in that case).
export async function finalizeCampaign(campaignId, { status, successCount, failureCount }) {
  const { rows } = await pool.query(
    `UPDATE marketing_campaigns
     SET status = $2, success_count = $3, failure_count = $4, sent_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [campaignId, status, successCount, failureCount]
  );
  return rows[0] || null;
}

export function toPublicCampaign(campaign) {
  if (!campaign) return null;
  return {
    id: campaign.id,
    name: campaign.name,
    channel: campaign.channel,
    provider: campaign.provider,
    audienceType: campaign.audience_type,
    audienceValue: campaign.audience_value,
    subject: campaign.subject,
    status: campaign.status,
    recipientCount: campaign.recipient_count,
    successCount: campaign.success_count,
    failureCount: campaign.failure_count,
    createdAt: campaign.created_at,
    scheduledAt: campaign.scheduled_at,
    sentAt: campaign.sent_at,
  };
}
