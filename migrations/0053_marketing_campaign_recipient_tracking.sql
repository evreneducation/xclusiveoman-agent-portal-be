-- Marketing Center Task 11 — Open & Click Tracking (MKT-3 / §8.12: "Sent
-- campaigns with recipient count, opens/clicks where available"; §6.11:
-- "campaign history with open/click stats").
--
-- Adds the minimum nullable/defaulted fields to the existing
-- marketing_campaign_recipients table — no new table. Per-recipient
-- aggregate state (a first-seen timestamp + a running total count) is
-- everything Campaign History/Campaign Detail/Recipient Detail need, and
-- it's everything the atomic "first open sets the timestamp, every open
-- (including the first) increments the count" update pattern
-- (services/marketingTracking.service.js) needs to implement race-safely —
-- an event-level log table isn't required by anything this task asks for.
--
-- Backward compatible by construction: existing recipient rows get
-- opened_at/clicked_at = NULL and open_count/click_count = 0 automatically
-- via these column defaults, exactly matching requirement 14.
ALTER TABLE marketing_campaign_recipients
  ADD COLUMN opened_at TIMESTAMPTZ,
  ADD COLUMN open_count INT NOT NULL DEFAULT 0,
  ADD COLUMN clicked_at TIMESTAMPTZ,
  ADD COLUMN click_count INT NOT NULL DEFAULT 0;
