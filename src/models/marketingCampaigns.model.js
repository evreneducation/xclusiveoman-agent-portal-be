const {
  pool
} = require('../db/pool.js');

const {
  listAgencies
} = require('./agencies.model.js');

const {
  newId
} = require('../utils/id.js');

// Marketing Center Task 5 — Send Campaign persistence + the server's own,
// independent audience resolution (never trusts a frontend-supplied
// recipient list/count — marketing.controller.js only ever passes through
// `audienceType`/`audienceValue` as *intent*).
//
// "Eligible" always means status = 'approved' — pending/rejected/suspended
// agencies are never real send targets, same rule the Task 3 UI's Audience
// card counts already apply. Mirrors that same three-segment mapping exactly
// (all / by country / inactive 30+ days) so the count an admin saw before
// confirming a send can never come back different here.
const INACTIVE_SINCE_DAYS = 30;

async function resolveAudience({ audienceType, audienceValue }) {
  if (audienceType === 'country') {
    return listAgencies({ status: 'approved', country: audienceValue });
  }
  if (audienceType === 'inactive_30d') {
    return listAgencies({ status: 'approved', inactiveSinceDays: INACTIVE_SINCE_DAYS });
  }
  // 'all'
  return listAgencies({ status: 'approved' });
}

module.exports.resolveAudience = resolveAudience;

async function createCampaign(
  client,
  {
    name, channel, provider, audienceType, audienceValue, subject, body,
    replyToAccountManager, recipientCount, createdByUserId, status, scheduledAt,
  }
) {
  const id = newId();
  await client.query(
    `INSERT INTO marketing_campaigns
      (id, name, channel, provider, audience_type, audience_value, subject, body,
       reply_to_account_manager, status, recipient_count, created_by_user_id, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, name, channel, provider, audienceType, audienceValue || null, subject || null, body,
      !!replyToAccountManager, status, recipientCount, createdByUserId, scheduledAt || null,
    ]
  );
  const { rows } = await client.query('SELECT * FROM marketing_campaigns WHERE id = ?', [id]);
  return rows[0];
}

module.exports.createCampaign = createCampaign;

// Task 11 (Open & Click Tracking) — the four correlated-subquery columns
// appended to every campaign row below are the one place engagement stats
// get computed (Campaign History's list, Campaign Detail, and anywhere else
// toPublicCampaign() is used all read the exact same aggregates, so they
// can never disagree). open_count_sum/click_count_sum are *total* events
// (every open/click, including repeats — marketing_campaign_recipients.
// open_count/click_count summed); unique_opens/unique_clicks are *distinct
// recipients* who opened/clicked at least once (opened_at/clicked_at IS NOT
// NULL) — toPublicCampaign() below exposes both, plus the rates
// (requirement 9). COALESCE(...,0) keeps a campaign with zero recipients
// (shouldn't happen in practice — every create/schedule path requires at
// least one) from ever returning NULL here.
const CAMPAIGN_ENGAGEMENT_COLUMNS = `
  COALESCE((SELECT SUM(r.open_count) FROM marketing_campaign_recipients r WHERE r.campaign_id = c.id), 0) AS open_count_sum,
  COALESCE((SELECT COUNT(*) FROM marketing_campaign_recipients r WHERE r.campaign_id = c.id AND r.opened_at IS NOT NULL), 0) AS unique_opens,
  COALESCE((SELECT SUM(r.click_count) FROM marketing_campaign_recipients r WHERE r.campaign_id = c.id), 0) AS click_count_sum,
  COALESCE((SELECT COUNT(*) FROM marketing_campaign_recipients r WHERE r.campaign_id = c.id AND r.clicked_at IS NOT NULL), 0) AS unique_clicks
`;

async function findCampaignById(id) {
  const { rows } = await pool.query(
    `SELECT c.*, ${CAMPAIGN_ENGAGEMENT_COLUMNS} FROM marketing_campaigns c WHERE c.id = ?`,
    [id]
  );
  return rows[0] || null;
}

module.exports.findCampaignById = findCampaignById;

async function listRecipientsByCampaign(campaignId) {
  const { rows } = await pool.query(
    `SELECT * FROM marketing_campaign_recipients WHERE campaign_id = ? ORDER BY created_at`,
    [campaignId]
  );
  return rows;
}

module.exports.listRecipientsByCampaign = listRecipientsByCampaign;

async function cancelScheduledCampaign(id) {
  const { rowCount } = await pool.query(
    `UPDATE marketing_campaigns SET status = 'cancelled', updated_at = now()
     WHERE id = ? AND status = 'scheduled'`,
    [id]
  );
  if (!rowCount) return null;
  const { rows } = await pool.query(`SELECT * FROM marketing_campaigns WHERE id = ?`, [id]);
  return rows[0] || null;
}

module.exports.cancelScheduledCampaign = cancelScheduledCampaign;

async function insertRecipients(client, campaignId, recipients) {
  const rows = [];
  for (const r of recipients) {
    const id = newId();
    await client.query(
      `INSERT INTO marketing_campaign_recipients (id, campaign_id, agency_id, channel, recipient_address, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, campaignId, r.agencyId, r.channel, r.recipientAddress]
    );
    const { rows: inserted } = await client.query(`SELECT * FROM marketing_campaign_recipients WHERE id = ?`, [id]);
    rows.push(inserted[0]);
  }
  return rows;
}

module.exports.insertRecipients = insertRecipients;

async function markRecipientSent(recipientId, { providerMessageId } = {}) {
  await pool.query(
    `UPDATE marketing_campaign_recipients SET status = 'sent', provider_message_id = ?, sent_at = now() WHERE id = ?`,
    [providerMessageId || null, recipientId]
  );
}

module.exports.markRecipientSent = markRecipientSent;

async function markRecipientFailed(recipientId, failureReason) {
  await pool.query(
    `UPDATE marketing_campaign_recipients SET status = 'failed', failure_reason = ? WHERE id = ?`,
    [failureReason || null, recipientId]
  );
}

module.exports.markRecipientFailed = markRecipientFailed;

async function finalizeCampaign(campaignId, { status, successCount, failureCount }) {
  await pool.query(
    `UPDATE marketing_campaigns
     SET status = ?, success_count = ?, failure_count = ?, sent_at = now(), updated_at = now()
     WHERE id = ?`,
    [status, successCount, failureCount, campaignId]
  );
  const { rows } = await pool.query(`SELECT * FROM marketing_campaigns WHERE id = ?`, [campaignId]);
  return rows[0] || null;
}

module.exports.finalizeCampaign = finalizeCampaign;

// requirement 9 — "Open Rate = recipients with opened_at / successfully
// sent recipients", computed here (not in the frontend) from real
// successCount/uniqueX values, and never dividing by zero: with no
// successful sends yet, the rate is null (displayed as "—", never "0%" or
// "NaN%" — a campaign that hasn't sent anything doesn't have a 0% open
// rate, it has no rate yet). Rounded to 1 decimal place.
function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function toPublicCampaign(campaign) {
  if (!campaign) return null;
  const successCount = campaign.success_count;
  // Task 11 — absent (undefined) on a row returned by createCampaign/
  // finalizeCampaign/cancelScheduledCampaign's own follow-up `SELECT *` (those
  // don't run the engagement-stats subqueries findCampaignById/
  // listCampaignsForAdmin do) rather than an error: a campaign that was
  // just created/sent/cancelled genuinely has zero opens/clicks so far,
  // which is exactly what defaulting to 0 here reports.
  const openCount = Number(campaign.open_count_sum ?? 0);
  const uniqueOpens = Number(campaign.unique_opens ?? 0);
  const clickCount = Number(campaign.click_count_sum ?? 0);
  const uniqueClicks = Number(campaign.unique_clicks ?? 0);
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
    successCount,
    failureCount: campaign.failure_count,
    createdAt: campaign.created_at,
    scheduledAt: campaign.scheduled_at,
    sentAt: campaign.sent_at,
    // Task 11 — only ever real values derived from
    // marketing_campaign_recipients, never a frontend-only counter.
    // openCount/clickCount are *total* events (repeats included);
    // uniqueOpens/uniqueClicks are distinct recipients (requirement 7).
    // Only meaningful for the built-in email path (Brevo) — see this same file's
    // module comment and marketingSend.service.js for why Mailchimp/Zoho/
    // WhatsApp Business API campaigns never accumulate real opens/clicks
    // (they never send at all yet).
    openCount,
    uniqueOpens,
    clickCount,
    uniqueClicks,
    openRate: rate(uniqueOpens, successCount),
    clickRate: rate(uniqueClicks, successCount),
  };
}

module.exports.toPublicCampaign = toPublicCampaign;

// --- Campaign History (Task 7) ---
//
// Mirrors packageRequestsAdmin.model.js's listPackageRequestsForAdmin
// shape/conventions exactly (count query + LIMIT/OFFSET page query, same
// { rows, total, page, pageSize } return) rather than inventing a new admin
// list pattern.

const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'partially_failed', 'failed', 'cancelled'];
const CAMPAIGN_CHANNELS = ['email', 'whatsapp'];

// Unrecognised status/channel values are silently ignored (no filter
// applied) rather than erroring — a stray/stale query param should never
// 500 an admin list page, and Postgres would otherwise reject an invalid
// value against these enum columns.
function buildCampaignFilters({ search, status, channel }) {
  const clauses = [];
  const values = [];

  if (status && CAMPAIGN_STATUSES.includes(status)) {
    clauses.push(`status = ?`);
    values.push(status);
  }
  if (channel && CAMPAIGN_CHANNELS.includes(channel)) {
    clauses.push(`channel = ?`);
    values.push(channel);
  }
  if (search) {
    clauses.push(`LOWER(name) LIKE LOWER(?)`);
    values.push(`%${search}%`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

async function listCampaignsForAdmin({ search, status, channel, page, pageSize } = {}) {
  const { where, values } = buildCampaignFilters({ search, status, channel });

  const { rows: countRows } = await pool.query(`SELECT COUNT(*) AS count FROM marketing_campaigns ${where}`, values);
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT c.*, ${CAMPAIGN_ENGAGEMENT_COLUMNS}
     FROM marketing_campaigns c ${where}
     ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

module.exports.listCampaignsForAdmin = listCampaignsForAdmin;

async function listRecipientsForAdmin(campaignId, { page, pageSize } = {}) {
  const limit = Math.max(1, Math.min(200, Number(pageSize) || 50));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS count FROM marketing_campaign_recipients WHERE campaign_id = ?`,
    [campaignId]
  );
  const total = Number(countRows[0].count);

  const { rows } = await pool.query(
    `SELECT r.*, a.name AS agency_name
     FROM marketing_campaign_recipients r
     LEFT JOIN agencies a ON a.id = r.agency_id
     WHERE r.campaign_id = ?
     ORDER BY r.created_at
     LIMIT ? OFFSET ?`,
    [campaignId, limit, offset]
  );

  return { rows, total, page: currentPage, pageSize: limit };
}

module.exports.listRecipientsForAdmin = listRecipientsForAdmin;

function toPublicCampaignDetail(campaign) {
  const base = toPublicCampaign(campaign);
  if (!base) return null;
  return {
    ...base,
    body: campaign.body,
    replyToAccountManager: campaign.reply_to_account_manager,
  };
}

module.exports.toPublicCampaignDetail = toPublicCampaignDetail;

function toPublicRecipient(row) {
  return {
    id: row.id,
    agencyId: row.agency_id,
    agencyName: row.agency_name || null,
    channel: row.channel,
    recipientAddress: row.recipient_address,
    status: row.status,
    failureReason: row.failure_reason,
    sentAt: row.sent_at,
    providerMessageId: row.provider_message_id,
    createdAt: row.created_at,
    // Task 11 (requirement 8) — real per-recipient engagement state, direct
    // from marketing_campaign_recipients (the same columns
    // marketingTracking.service.js#recordOpen/recordClick update
    // atomically). `row.open_count`/`row.click_count` already default to 0
    // at the database level (0053_marketing_campaign_recipient_tracking.sql)
    // for every recipient, existing or new — never undefined here.
    openedAt: row.opened_at,
    openCount: row.open_count,
    clickedAt: row.clicked_at,
    clickCount: row.click_count,
  };
}

module.exports.toPublicRecipient = toPublicRecipient;
