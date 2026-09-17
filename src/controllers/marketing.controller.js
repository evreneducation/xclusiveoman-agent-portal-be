const {
  sendEmail
} = require('../services/email.service.js');

const {
  buildMarketingEmailHtml,
  resolveTrackedLinks
} = require('../services/emailTemplate.service.js');

const {
  zonedDateTimeToUtc
} = require('../utils/timezone.js');

const {
  cancelScheduledCampaign,
  findCampaignById,
  listCampaignsForAdmin,
  listRecipientsForAdmin,
  toPublicCampaign,
  toPublicCampaignDetail,
  toPublicRecipient
} = require('../models/marketingCampaigns.model.js');

const {
  executeCampaignSend,
  getChannelStatuses,
  insertCampaignWithRecipients,
  isKnownMarketingProvider,
  resolveRecipients,
  testProviderConnection,
  unavailableProviderReason
} = require('../services/marketingSend.service.js');

const {
  recordCampaignEvent
} = require('../services/marketingActivity.service.js');

const NO_RECIPIENTS_MESSAGE = 'No eligible agencies (approved, with an active owner account) match this audience selection.';

async function sendTest(req, res, next) {
  try {
    const { channel, provider, subject, body, recipientEmail } = req.body;

    const reason = unavailableProviderReason(channel, provider);
    if (reason) {
      return res.status(400).json({ error: 'provider_not_configured', message: reason });
    }

    // Same branded HTML wrapper Send Campaign uses (marketingSend.service.js#
    // executeCampaignSend) — only for email, so what Send Test previews is
    // exactly what a real campaign would look like, never a different
    // (plain-text) preview of a styled send.
    const emailTemplate = channel === 'email' ? buildMarketingEmailHtml({ subject, bodyText: body }) : null;

    // Task 11, requirement 15 — decision, documented: Send Test never
    // creates a marketing_campaign_recipients row (by design, unchanged
    // since Task 5 — see this function's own top comment: "no campaign/
    // recipient rows created"), so there is no valid recipient id to sign a
    // tracking token against. Rather than invent persistence solely to make
    // tracking "work" for a one-off preview send, links are resolved
    // straight to their real destination (no click-tracking wrapper) and no
    // open-tracking pixel is appended at all — a test send is genuinely
    // never trackable, and the email honestly reflects that rather than
    // silently no-op-ing on a broken/self-referential tracking link.
    const html = emailTemplate ? resolveTrackedLinks(emailTemplate.html, emailTemplate.links, (url) => url) : undefined;

    const result = await sendEmail({
      to: recipientEmail,
      subject,
      text: body,
      html,
      attachments: emailTemplate?.attachments,
    });
    if (!result.delivered) {
      // Shouldn't happen once unavailableProviderReason() has already
      // passed above, but sendEmail()'s own `delivered` flag is the one
      // source of truth for "did this actually go out" — never report
      // success off anything else (e.g. the absence of a thrown error).
      return res.status(502).json({ error: 'send_failed', message: 'The test email could not be delivered.' });
    }
    res.json({ delivered: true });
  } catch (err) {
    next(err);
  }
}

module.exports.sendTest = sendTest;

async function createCampaign(req, res, next) {
  try {
    const { name, channel, provider, audienceType, audienceValue, subject, body, replyToAccountManager } = req.body;

    const recipients = await resolveRecipients({ audienceType, audienceValue, channel });
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'no_recipients', message: NO_RECIPIENTS_MESSAGE });
    }

    const campaign = await insertCampaignWithRecipients({
      name,
      channel,
      provider,
      audienceType,
      audienceValue,
      subject,
      body,
      replyToAccountManager,
      recipients,
      createdByUserId: req.user.id,
      status: 'sending',
    });

    const finalCampaign = await executeCampaignSend(campaign.id);
    const reason = unavailableProviderReason(channel, provider);

    res.status(201).json({
      campaign: toPublicCampaign(finalCampaign),
      ...(reason ? { configurationError: reason } : {}),
    });
  } catch (err) {
    next(err);
  }
}

module.exports.createCampaign = createCampaign;

async function scheduleCampaign(req, res, next) {
  try {
    const {
      name,
      channel,
      provider,
      audienceType,
      audienceValue,
      subject,
      body,
      replyToAccountManager,
      scheduledDate,
      scheduledTime,
      scheduledTimezone,
    } = req.body;

    const scheduledAt = zonedDateTimeToUtc(scheduledDate, scheduledTime, scheduledTimezone);
    if (!scheduledAt || scheduledAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'validation_error', message: 'Scheduled time must be in the future.' });
    }

    const recipients = await resolveRecipients({ audienceType, audienceValue, channel });
    if (recipients.length === 0) {
      return res.status(400).json({ error: 'no_recipients', message: NO_RECIPIENTS_MESSAGE });
    }

    const campaign = await insertCampaignWithRecipients({
      name,
      channel,
      provider,
      audienceType,
      audienceValue,
      subject,
      body,
      replyToAccountManager,
      recipients,
      createdByUserId: req.user.id,
      status: 'scheduled',
      scheduledAt,
    });

    // Task 8 — Admin Activity + Notification. Runs exactly once, right
    // after the one INSERT that creates this campaign — see
    // marketingActivity.service.js#recordCampaignEvent's own comment for
    // why no separate dedupe key is needed.
    await recordCampaignEvent('scheduled', campaign, { actorUserId: req.user.id });

    res.status(201).json({ campaign: toPublicCampaign(campaign) });
  } catch (err) {
    next(err);
  }
}

module.exports.scheduleCampaign = scheduleCampaign;

async function cancelCampaign(req, res, next) {
  try {
    const { id } = req.params;
    const cancelled = await cancelScheduledCampaign(id);
    if (!cancelled) {
      return res.status(404).json({
        error: 'not_found',
        message: 'No scheduled campaign found with that id — it may already have sent, been cancelled, or never existed.',
      });
    }

    // Task 8 — only reached when the WHERE status = 'scheduled' guard above
    // actually matched a row, so this can fire at most once per campaign
    // (a second cancel attempt hits the 404 branch instead).
    await recordCampaignEvent('cancelled', cancelled, { actorUserId: req.user.id });

    res.json({ campaign: toPublicCampaign(cancelled) });
  } catch (err) {
    next(err);
  }
}

module.exports.cancelCampaign = cancelCampaign;

async function listCampaigns(req, res, next) {
  try {
    const { search, status, channel, page, pageSize } = req.query;
    const { rows, total, page: currentPage, pageSize: limit } = await listCampaignsForAdmin({
      search, status, channel, page, pageSize,
    });
    res.json({
      campaigns: rows.map(toPublicCampaign),
      pagination: { total, page: currentPage, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
}

module.exports.listCampaigns = listCampaigns;

async function getCampaign(req, res, next) {
  try {
    const campaign = await findCampaignById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'not_found' });
    res.json({ campaign: toPublicCampaignDetail(campaign) });
  } catch (err) {
    next(err);
  }
}

module.exports.getCampaign = getCampaign;

async function listCampaignRecipients(req, res, next) {
  try {
    const campaign = await findCampaignById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'not_found' });

    const { page, pageSize } = req.query;
    const { rows, total, page: currentPage, pageSize: limit } = await listRecipientsForAdmin(req.params.id, { page, pageSize });
    res.json({
      recipients: rows.map(toPublicRecipient),
      pagination: { total, page: currentPage, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
}

module.exports.listCampaignRecipients = listCampaignRecipients;

async function getChannels(req, res, next) {
  try {
    const providers = await getChannelStatuses();
    res.json({ providers });
  } catch (err) {
    next(err);
  }
}

module.exports.getChannels = getChannels;

async function testChannelConnection(req, res, next) {
  try {
    const { provider } = req.params;
    if (!isKnownMarketingProvider(provider)) {
      return res.status(404).json({ error: 'not_found', message: 'Unknown provider.' });
    }
    const result = await testProviderConnection(provider);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports.testChannelConnection = testChannelConnection;
