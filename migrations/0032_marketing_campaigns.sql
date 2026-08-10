-- Marketing Center (PRD screen 17) Task 5 — Send Test + Send Campaign.
-- Two tables: one row per campaign send attempt, one row per resolved
-- recipient within it (so a partial failure is auditable per-agency, not
-- just a single pass/fail flag on the campaign). Campaign History UI (a
-- separate, later task) will read these same two tables — nothing here is
-- speculative beyond what this task's send flow actually writes.
--
-- Enum values mirror the frontend's existing Task 2/3/4 vocabulary exactly
-- (Channel/Provider selects, the four Audience segments, campaign statuses
-- named in the task spec) rather than inventing a parallel naming scheme.
CREATE TYPE marketing_campaign_channel AS ENUM ('email', 'whatsapp');
CREATE TYPE marketing_campaign_provider AS ENUM ('mailchimp', 'zoho', 'built_in', 'whatsapp_business_api');
CREATE TYPE marketing_campaign_audience_type AS ENUM ('all', 'tier', 'country', 'inactive_30d');
CREATE TYPE marketing_campaign_status AS ENUM ('draft', 'sending', 'sent', 'partially_failed', 'failed');
CREATE TYPE marketing_campaign_recipient_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel marketing_campaign_channel NOT NULL,
  provider marketing_campaign_provider NOT NULL,
  audience_type marketing_campaign_audience_type NOT NULL,
  -- Tier ('gold'/'silver'/'bronze') or country name, matching whichever
  -- audience_type was picked; NULL for 'all' and 'inactive_30d', which need
  -- no extra parameter.
  audience_value TEXT,
  -- Email only — NULL for WhatsApp sends (Task 4's Message card never shows
  -- a subject field for that channel).
  subject TEXT,
  body TEXT NOT NULL,
  reply_to_account_manager BOOLEAN NOT NULL DEFAULT false,
  status marketing_campaign_status NOT NULL DEFAULT 'draft',
  recipient_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_campaigns_status ON marketing_campaigns(status);

-- One row per resolved recipient (the server's own independently-resolved
-- audience — never a frontend-supplied list). agency_id is nullable only so
-- a future non-agency recipient type wouldn't need a schema change; every
-- row this task writes always has one, since the only implemented audience
-- source is agencies.
CREATE TABLE marketing_campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  agency_id UUID REFERENCES agencies(id),
  channel marketing_campaign_channel NOT NULL,
  recipient_address TEXT NOT NULL,
  status marketing_campaign_recipient_status NOT NULL DEFAULT 'pending',
  provider_message_id TEXT,
  failure_reason TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_marketing_campaign_recipients_campaign ON marketing_campaign_recipients(campaign_id);
