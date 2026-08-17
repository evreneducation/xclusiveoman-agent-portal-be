import { pool } from '../db/pool.js';
import { isSmtpConfigured, sendEmail, verifySmtpConnection } from './email.service.js';
import { buildMarketingEmailHtml, resolveTrackedLinks, appendTrackingPixel } from './emailTemplate.service.js';
import { buildOpenTrackingUrl, buildClickTrackingUrl } from './marketingTracking.service.js';
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
import { recordCampaignEvent } from './marketingActivity.service.js';

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

// --- Channel Settings (Task 9) ---
//
// The exact channel -> provider pairing validation/schemas.js's
// CHANNEL_PROVIDERS already enforces server-side on every campaign
// create/schedule request — repeated here (not imported: schemas.js keeps
// its consts module-private, same as this file's own PROVIDER_LABELS
// above) only as the list of providers Channel Settings has anything to
// report a status for, never as a second source of truth for which
// provider a given campaign is allowed to use.
const CHANNEL_PROVIDERS = {
  email: ['built_in', 'mailchimp', 'zoho'],
  whatsapp: ['whatsapp_business_api'],
};

// Display labels for Channel Settings / Compose's Channel card — separate
// from PROVIDER_LABELS above (which reads as a sentence fragment, e.g. "The
// built-in sender is not configured yet…") since these are card headings.
const PROVIDER_DISPLAY_LABELS = {
  built_in: 'Built-in sender',
  mailchimp: 'Mailchimp',
  zoho: 'Zoho Campaigns',
  whatsapp_business_api: 'WhatsApp Business API',
};

export function isKnownMarketingProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_DISPLAY_LABELS, provider);
}

// The one place that decides a provider's real status — never "connected"
// merely because credentials exist. built_in is the only provider with any
// configuration surface at all today (env vars — see email.service.js);
// verifySmtpConnection() does a real round-trip to the SMTP server, so
// "connected" here means the server just now accepted the credentials, not
// just that three env vars are non-empty. Mailchimp, Zoho Campaigns, and
// WhatsApp Business API are reported 'not_implemented' rather than
// 'configuration_required': confirmed by inspection there is no SDK
// dependency, no credential env var, and no credential storage anywhere in
// this backend for any of the three — and the project's own documentation
// (Xclusive Oman Master Documentation §3.2 "Out of Scope (MVP)") explicitly
// places WhatsApp Business API automated sending in Phase 2. Never invents
// a configuration form for a provider that has nowhere real to send its
// values.
async function computeProviderStatus(provider) {
  if (provider === 'built_in') {
    if (!isSmtpConfigured()) {
      return {
        status: 'configuration_required',
        message: 'SMTP is configured through the deployment environment (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS) — those variables are not currently set.',
      };
    }
    const result = await verifySmtpConnection();
    return result.verified
      ? { status: 'connected', message: null }
      : { status: 'connection_failed', message: result.reason };
  }
  if (provider === 'mailchimp') {
    return { status: 'not_implemented', message: 'No Mailchimp integration exists yet — this provider cannot send campaigns.' };
  }
  if (provider === 'zoho') {
    return { status: 'not_implemented', message: 'No Zoho Campaigns integration exists yet — this provider cannot send campaigns.' };
  }
  if (provider === 'whatsapp_business_api') {
    return {
      status: 'not_implemented',
      message: 'WhatsApp Business API integration is out of scope for this MVP (see project documentation) — this provider cannot send campaigns.',
    };
  }
  return { status: 'not_implemented', message: null };
}

// GET /admin/marketing/channels — every provider Compose's own Channel
// section offers, with its real status.
export async function getChannelStatuses() {
  const results = [];
  for (const [channel, providers] of Object.entries(CHANNEL_PROVIDERS)) {
    for (const provider of providers) {
      // eslint-disable-next-line no-await-in-loop -- four providers total, one SMTP round-trip at most; a Promise.all here buys nothing worth the extra complexity.
      const { status, message } = await computeProviderStatus(provider);
      results.push({ channel, provider, label: PROVIDER_DISPLAY_LABELS[provider], status, message });
    }
  }
  return results;
}

// POST /admin/marketing/channels/:provider/test-connection — same
// computation as above, for a single provider on demand. Diagnostic only:
// nothing is written anywhere (no config row exists to update), so this is
// always safe to call as often as an admin wants.
export async function testProviderConnection(provider) {
  return computeProviderStatus(provider);
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

  // Branded HTML version of the campaign's plain subject/body (Compose has
  // no rich text editor — this is the only formatting step), built once
  // (identical for every recipient — only Reply-To varies per-agency below)
  // and only for email; a WhatsApp campaign has no HTML body to build (and
  // in practice never reaches here today — whatsapp_business_api always has
  // a non-null `reason` above, from unavailableProviderReason).
  const emailTemplate =
    campaign.channel === 'email' && !reason ? buildMarketingEmailHtml({ subject: campaign.subject, bodyText: campaign.body }) : null;

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

      // Task 11 — Open & Click Tracking. Each recipient gets their own
      // signed tracking pixel + click-tracking links (never a single
      // campaign-level identifier — a shared token couldn't tell recipients
      // apart), built fresh per recipient from the one shared template.
      // Only for a real send: a row here always has a real
      // marketing_campaign_recipients.id to attribute the open/click to
      // (unlike Send Test — see marketing.controller.js#sendTest's own
      // comment on why that path never tracks).
      let html = emailTemplate?.html;
      if (html) {
        html = resolveTrackedLinks(html, emailTemplate.links, (url) => buildClickTrackingUrl(row.id, url));
        html = appendTrackingPixel(html, buildOpenTrackingUrl(row.id));
      }

      const result = await sendEmail({
        to: row.recipient_address,
        subject: campaign.subject,
        text: campaign.body,
        html,
        attachments: emailTemplate?.attachments,
        replyTo,
      });
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
  const finalCampaign = await finalizeCampaign(campaignId, { status: finalStatus, successCount, failureCount });

  // Task 8 — Admin Activity + Notification, fired exactly once here: this
  // is the single call site every send path (send-now via
  // marketing.controller.js#createCampaign, and a scheduled campaign via
  // marketingScheduler.job.js) funnels through, right at the point the
  // campaign's final state is authoritatively written.
  await recordCampaignEvent(finalStatus, finalCampaign);

  return finalCampaign;
}
