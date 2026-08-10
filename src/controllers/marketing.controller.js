import { sendEmail } from '../services/email.service.js';
import { zonedDateTimeToUtc } from '../utils/timezone.js';
import { cancelScheduledCampaign, toPublicCampaign } from '../models/marketingCampaigns.model.js';
import {
  executeCampaignSend,
  insertCampaignWithRecipients,
  resolveRecipients,
  unavailableProviderReason,
} from '../services/marketingSend.service.js';

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

    const result = await sendEmail({ to: recipientEmail, subject, text: body });
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
    res.json({ campaign: toPublicCampaign(cancelled) });
  } catch (err) {
    next(err);
  }
}
