ALTER TABLE marketing_campaign_recipients
  ADD COLUMN opened_at DATETIME,
  ADD COLUMN open_count INT NOT NULL DEFAULT 0,
  ADD COLUMN clicked_at DATETIME,
  ADD COLUMN click_count INT NOT NULL DEFAULT 0;
