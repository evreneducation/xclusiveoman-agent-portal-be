-- marketing_campaign_status's final value list folds in
-- 0033_marketing_campaign_scheduling.sql's later ALTER TYPE ... ADD VALUE
-- additions ('scheduled', 'cancelled') — MySQL enums are inline per-column,
-- so the whole lifecycle is defined once here; 0033 keeps its other
-- (non-enum) ALTER TABLE statement and drops just the enum ones.
CREATE TABLE marketing_campaigns (
  id CHAR(36) PRIMARY KEY,
  name TEXT NOT NULL,
  channel ENUM('email', 'whatsapp') NOT NULL,
  provider ENUM('mailchimp', 'zoho', 'built_in', 'whatsapp_business_api') NOT NULL,
  audience_type ENUM('all', 'tier', 'country', 'inactive_30d') NOT NULL,
  audience_value TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  reply_to_account_manager BOOLEAN NOT NULL DEFAULT false,
  status ENUM('draft', 'sending', 'sent', 'partially_failed', 'failed', 'scheduled', 'cancelled') NOT NULL DEFAULT 'draft',
  recipient_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  created_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_marketing_campaigns_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_marketing_campaigns_status ON marketing_campaigns(status);

CREATE TABLE marketing_campaign_recipients (
  id CHAR(36) PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  agency_id CHAR(36),
  channel ENUM('email', 'whatsapp') NOT NULL,
  recipient_address TEXT NOT NULL,
  status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  provider_message_id TEXT,
  failure_reason TEXT,
  sent_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_marketing_campaign_recipients_campaign FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_marketing_campaign_recipients_agency FOREIGN KEY (agency_id) REFERENCES agencies(id)
);

CREATE INDEX idx_marketing_campaign_recipients_campaign ON marketing_campaign_recipients(campaign_id);
