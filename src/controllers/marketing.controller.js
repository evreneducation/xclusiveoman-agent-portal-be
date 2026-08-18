import { sendEmail } from '../services/email.service.js';
import { buildMarketingEmailHtml, resolveTrackedLinks } from '../services/emailTemplate.service.js';
import { zonedDateTimeToUtc } from '../utils/timezone.js';
import {
  cancelScheduledCampaign,
  findCampaignById,
  listCampaignsForAdmin,
  listRecipientsForAdmin,
  toPublicCampaign,
  toPublicCampaignDetail,
  toPublicRecipient,
} from '../models/marketingCampaigns.model.js';
import {
  executeCampaignSend,
  getChannelStatuses,
  insertCampaignWithRecipients,
  isKnownMarketingProvider,
  resolveRecipients,
  testProviderConnection,
  unavailableProviderReason,
} from '../services/marketingSend.service.js';
import { recordCampaignEvent } from '../services/marketingActivity.service.js';

const NO_RECIPIENTS_MESSAGE = 'No eligible agencies (approved, with an active owner account) match this audience selection.';

// POST /api/admin/marketing/send-test — a single, one-off email using
// whatever Provider/Subject/Body is currently selected in Compose. Never
// touches the audience or the campaign tables — "must NOT send to the
// selected audience" — so there's no persistence here at all, unlike
// createCampaign/scheduleCampaign below.
export async function sendTest(req, res, next) {
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

// POST /api/admin/marketing/campaigns (Task 5, unchanged behavior/response
// shape — only the internals were refactored into marketingSend.service.js
// so Task 6's scheduler can reuse them) — resolves the audience itself
// (never trusts a frontend-supplied recipient list/count), persists the
// campaign + one recipient row per resolved, emailable agency, then sends
// immediately.
export async function createCampaign(req, res, next) {
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

// POST /api/admin/marketing/campaigns/schedule (Task 6) — same audience
// resolution and persistence as createCampaign above, just:
//   1. converts the admin's zoned date/time to a real UTC instant and
//      re-validates it's in the future (defense in depth beyond the zod
//      schema's own refine — the backend never trusts a single layer of
//      "the frontend already checked this"),
//   2. inserts the campaign as `status: 'scheduled'` with that instant as
//      `scheduled_at`, and never calls executeCampaignSend — nothing is
//      sent here. jobs/marketingScheduler.job.js picks it up once due.
export async function scheduleCampaign(req, res, next) {
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

// POST /api/admin/marketing/campaigns/:id/cancel (Task 6) — only ever
// affects a campaign still in `scheduled` state (enforced by the model's
// own WHERE clause, not a check-then-update race here); 404 either way if
// it doesn't exist or already moved on (sending/sent/etc.) — no need to
// distinguish those cases for the admin cancelling it.
export async function cancelCampaign(req, res, next) {
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

// GET /api/admin/marketing/campaigns?search=&status=&channel=&page=&pageSize=
// Campaign History (Task 7) — real marketing_campaigns rows only, search
// (name) + status/channel filters + pagination, same response shape as
// packageRequestsAdmin.controller.js#list.
export async function listCampaigns(req, res, next) {
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

// GET /api/admin/marketing/campaigns/:id — Campaign Details (Task 7,
// requirement 9). toPublicCampaignDetail adds body/replyToAccountManager on
// top of the summary fields toPublicCampaign already returns — never any
// provider credential/secret, since this table doesn't store one.
export async function getCampaign(req, res, next) {
  try {
    const campaign = await findCampaignById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'not_found' });
    res.json({ campaign: toPublicCampaignDetail(campaign) });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/marketing/campaigns/:id/recipients — Recipient Details
// (Task 7, requirement 10), paginated the same way the list above is so a
// large-audience campaign never loads unboundedly.
export async function listCampaignRecipients(req, res, next) {
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

// GET /api/admin/marketing/channels — Channel Settings (Task 9). Real,
// backend-verified status per provider — never the hard-coded
// "Configuration required" ComposeTab's old CONNECTION_STATUS_META used to
// show for every provider regardless of actual state. Never includes a
// credential/secret: this response is built entirely from
// getChannelStatuses()'s { channel, provider, label, status, message }
// shape, which never reads (let alone echoes back) an SMTP password or any
// other credential value.
export async function getChannels(req, res, next) {
  try {
    const providers = await getChannelStatuses();
    res.json({ providers });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/marketing/channels/:provider/test-connection — Task 9.
// Purely diagnostic (nothing is persisted — there is no provider config row
// to update), so this is safe to call as often as an admin wants. Unknown
// provider ids 404 rather than silently reporting a made-up status.
export async function testChannelConnection(req, res, next) {
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
