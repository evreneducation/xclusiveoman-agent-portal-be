const {
  pool
} = require('../db/pool.js');

const {
  isBrevoConfigured,
  sendEmail,
  verifyBrevoConnection
} = require('./email.service.js');

const {
  buildMarketingEmailHtml,
  resolveTrackedLinks,
  appendTrackingPixel
} = require('./emailTemplate.service.js');

const {
  buildOpenTrackingUrl,
  buildClickTrackingUrl
} = require('./marketingTracking.service.js');

const {
  listAgencyOwnerEmails
} = require('../models/users.model.js');

const {
  findRmEmailsByAgencyIds
} = require('../models/agencies.model.js');

const {
  createCampaign: insertCampaignRow,
  finalizeCampaign,
  findCampaignById,
  insertRecipients,
  listRecipientsByCampaign,
  markRecipientFailed,
  markRecipientSent,
  resolveAudience
} = require('../models/marketingCampaigns.model.js');

const {
  recordCampaignEvent
} = require('./marketingActivity.service.js');

// Marketing Center Task 5's send logic, extracted out of the controller so
// Task 6's scheduler (jobs/marketingScheduler.job.js) can call the exact
// same code a send-now request does — not a reimplementation of it.

const PROVIDER_LABELS = {
  mailchimp: 'Mailchimp',
  zoho: 'Zoho Campaigns',
  built_in: 'The built-in sender',
  whatsapp_business_api: 'WhatsApp Business API',
};

function unavailableProviderReason(channel, provider) {
  if (channel === 'email' && provider === 'built_in') {
    return isBrevoConfigured() ? null : `${PROVIDER_LABELS.built_in} is not configured yet (no Brevo credentials set).`;
  }
  return `${PROVIDER_LABELS[provider] || provider} is not connected yet — configure it in Channel Settings before sending.`;
}

module.exports.unavailableProviderReason = unavailableProviderReason;

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

function isKnownMarketingProvider(provider) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_DISPLAY_LABELS, provider);
}

module.exports.isKnownMarketingProvider = isKnownMarketingProvider;

// The one place that decides a provider's real status — never "connected"
// merely because credentials exist. built_in is the only provider with any
// configuration surface at all today (env vars — see email.service.js);
// verifyBrevoConnection() does a real auth check against Brevo's API, so
// "connected" here means Brevo just now accepted the API key, not just that
// the two env vars are non-empty. Mailchimp, Zoho Campaigns, and WhatsApp
// Business API are reported 'not_implemented' rather than
// 'configuration_required': confirmed by inspection there is no SDK
// dependency, no credential env var, and no credential storage anywhere in
// this backend for any of the three — and the project's own documentation
// (Xclusive Oman Master Documentation §3.2 "Out of Scope (MVP)") explicitly
// places WhatsApp Business API automated sending in Phase 2. Never invents
// a configuration form for a provider that has nowhere real to send its
// values.
async function computeProviderStatus(provider) {
  if (provider === 'built_in') {
    if (!isBrevoConfigured()) {
      return {
        status: 'configuration_required',
        message: 'Brevo is configured through the deployment environment (BREVO_API_KEY/BREVO_SENDER_EMAIL/BREVO_SENDER_NAME) — those variables are not currently set.',
      };
    }
    const result = await verifyBrevoConnection();
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

async function getChannelStatuses() {
  const results = [];
  for (const [channel, providers] of Object.entries(CHANNEL_PROVIDERS)) {
    for (const provider of providers) {
      // eslint-disable-next-line no-await-in-loop -- four providers total, one Brevo API round-trip at most; a Promise.all here buys nothing worth the extra complexity.
      const { status, message } = await computeProviderStatus(provider);
      results.push({ channel, provider, label: PROVIDER_DISPLAY_LABELS[provider], status, message });
    }
  }
  return results;
}

module.exports.getChannelStatuses = getChannelStatuses;

async function testProviderConnection(provider) {
  return computeProviderStatus(provider);
}

module.exports.testProviderConnection = testProviderConnection;

async function resolveRecipients({ audienceType, audienceValue, channel }) {
  const agencies = await resolveAudience({ audienceType, audienceValue });
  const ownerRows = await listAgencyOwnerEmails(agencies.map((a) => a.id));
  const ownerEmailByAgency = new Map(ownerRows.map((r) => [r.agency_id, r.email]));
  return agencies
    .filter((a) => ownerEmailByAgency.has(a.id))
    .map((a) => ({ agencyId: a.id, channel, recipientAddress: ownerEmailByAgency.get(a.id) }));
}

module.exports.resolveRecipients = resolveRecipients;

async function insertCampaignWithRecipients(
  {
    name, channel, provider, audienceType, audienceValue, subject, body,
    replyToAccountManager, recipients, createdByUserId, status, scheduledAt,
  }
) {
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

module.exports.insertCampaignWithRecipients = insertCampaignWithRecipients;

async function executeCampaignSend(campaignId) {
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

module.exports.executeCampaignSend = executeCampaignSend;
