import { pool } from '../db/pool.js';
import { isSmtpConfigured, sendEmail } from './email.service.js';
import { listAgencyOwnerEmails } from '../models/users.model.js';
import { findRmEmailsByAgencyIds } from '../models/agencies.model.js';
import {
  createCampaign as insertCampaignRow,
  finalizeCampaign,
  findCampaignById,
  insertRecipients,
  listRecipientsByCampaign,
  markRecipientFailed,
  markRecipientSent,
  resolveAudience,
} from '../models/marketingCampaigns.model.js';

// Marketing Center Task 5's send logic, extracted out of the controller so
// Task 6's scheduler (jobs/marketingScheduler.job.js) can call the exact
// same code a send-now request does — not a reimplementation of it.

const PROVIDER_LABELS = {
  mailchimp: 'Mailchimp',
  zoho: 'Zoho Campaigns',
  built_in: 'The built-in sender',
  whatsapp_business_api: 'WhatsApp Business API',
};

// Only Email + Built-in sender has a real send path today — no Mailchimp,
// Zoho Campaigns, or WhatsApp Business API integration exists anywhere in
// this backend (confirmed by inspection: no `mailchimp`/`zoho` reference
// anywhere, and the only `whatsapp` code is a manual wa.me click-to-chat
// link helper, not a send API). Send Test, send-now, and every scheduled
// send all check this same helper before attempting anything, so an
// unconfigured provider always gets one clear, honest reason instead of a
// faked "sent" response. Returns null when the provider is actually usable.
export function unavailableProviderReason(channel, provider) {
  if (channel === 'email' && provider === 'built_in') {
    return isSmtpConfigured() ? null : `${PROVIDER_LABELS.built_in} is not configured yet (no SMTP credentials set).`;
  }
  return `${PROVIDER_LABELS[provider] || provider} is not connected yet — configure it in Channel Settings before sending.`;
}

// Server-side audience resolution + the emailable recipient set (each
// agency's active owner account) — never trusts a frontend-supplied
// recipient list/count, and identical whether called for an immediate send
// or a schedule (a campaign's actual recipients can't depend on which path
// created it). Agencies with no active owner account are dropped entirely
// rather than counted as a recipient that could never actually be reached.
export async function resolveRecipients({ audienceType, audienceValue, channel }) {
  const agencies = await resolveAudience({ audienceType, audienceValue });
  const ownerRows = await listAgencyOwnerEmails(agencies.map((a) => a.id));
  const ownerEmailByAgency = new Map(ownerRows.map((r) => [r.agency_id, r.email]));
  return agencies
    .filter((a) => ownerEmailByAgency.has(a.id))
    .map((a) => ({ agencyId: a.id, channel, recipientAddress: ownerEmailByAgency.get(a.id) }));
}

// Campaign + its recipient rows, inserted as one short transaction — durable
// before any (slow, external) send attempt starts, so a crash mid-send (or,
// for a scheduled campaign, any time between now and whenever it's due)
// still leaves an accurate "who was supposed to get this" record rather
// than losing it. `status` is 'sending' (send-now — executeCampaignSend
// runs immediately after) or 'scheduled' (send deferred to `scheduledAt`,
// the scheduler job's job to run later).
export async function insertCampaignWithRecipients({
  name, channel, provider, audienceType, audienceValue, subject, body,
  replyToAccountManager, recipients, createdByUserId, status, scheduledAt,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const campaign = await insertCampaignRow(client, {
      name, channel, provider, audienceType, audienceValue, subject, body,
      replyToAccountManager, recipientCount: recipients.length, createdByUserId, status, scheduledAt,
    });
    await insertRecipients(client, campaign.id, recipients);
    await client.query('COMMIT');
    return campaign;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// The actual send. Reads the campaign + its already-inserted (`pending`)
// recipient rows back from the database rather than being handed them in
// memory, so it behaves identically whether called seconds after insertion
// (send-now, marketing.controller.js#createCampaign) or hours/days later by
// a completely different process tick (the scheduler job, once a scheduled
// campaign's time comes due) — same inputs read the same way, same code
// path, same outcome logic either way.
//
// Reply-To (when the campaign has reply_to_account_manager set) is resolved
// fresh here, at actual send time, from each agency's *current* assigned
// Relationship Manager — not a value captured when the campaign was
// composed/scheduled, so a later RM reassignment is honored. Never one
// global address for the whole campaign, and simply omitted for an agency
// with no RM assigned.
export async function executeCampaignSend(campaignId) {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) return null;

  const recipientRows = await listRecipientsByCampaign(campaignId);
  const reason = unavailableProviderReason(campaign.channel, campaign.provider);

  let rmEmailByAgency = new Map();
  if (campaign.reply_to_account_manager && !reason) {
    const agencyIds = [...new Set(recipientRows.map((r) => r.agency_id).filter(Boolean))];
    const rmRows = await findRmEmailsByAgencyIds(agencyIds);
    rmEmailByAgency = new Map(rmRows.map((r) => [r.agency_id, r.rm_email]));
  }

  let successCount = 0;
  let failureCount = 0;

  for (const row of recipientRows) {
    if (reason) {
      await markRecipientFailed(row.id, reason);
      failureCount += 1;
      continue;
    }
    try {
      const replyTo = campaign.reply_to_account_manager ? rmEmailByAgency.get(row.agency_id) || undefined : undefined;
      const result = await sendEmail({ to: row.recipient_address, subject: campaign.subject, text: campaign.body, replyTo });
      if (result.delivered) {
        await markRecipientSent(row.id);
        successCount += 1;
      } else {
        await markRecipientFailed(row.id, 'Delivery could not be confirmed.');
        failureCount += 1;
      }
    } catch (err) {
      // One bad recipient (invalid address, provider hiccup) never aborts
      // the rest of the send.
      await markRecipientFailed(row.id, err.message || 'Send failed');
      failureCount += 1;
    }
  }

  // Meaningful statuses only — never reported as fully "sent" when any
  // recipient failed.
  const finalStatus = successCount === 0 ? 'failed' : failureCount === 0 ? 'sent' : 'partially_failed';
  return finalizeCampaign(campaignId, { status: finalStatus, successCount, failureCount });
}
