-- MICE Costing & Markup Panel (continues 0024_mice_rfqs.sql — net_cost_total/
-- markup_rule/sell_price already exist there, reserved for exactly this,
-- reused as-is/not duplicated). Only what didn't already exist gets added:
-- a structured per-component breakdown (net_cost_total stays the aggregate
-- Landing Cost, matching the doc's column), an admin-only notes field, and
-- who/when a proposal was published — same three additions
-- package_requests got for its own costing task (0021).
ALTER TABLE mice_rfqs
  ADD COLUMN cost_breakdown JSONB,
  ADD COLUMN internal_notes TEXT,
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN published_by_user_id UUID REFERENCES users(id);
