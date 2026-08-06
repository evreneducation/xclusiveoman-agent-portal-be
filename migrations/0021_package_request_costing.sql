-- Custom FIT Costing & Quote Publishing (continues 0016_package_requests.sql
-- — net_cost_breakdown/markup_rule/sell_price already exist there, reserved
-- for exactly this, and are reused as-is/not duplicated). Only what didn't
-- already exist gets added here: an admin-only notes field, and who/when a
-- quote was published.
ALTER TABLE package_requests
  ADD COLUMN internal_notes TEXT,
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN published_by_user_id UUID REFERENCES users(id);

-- Generic activity/audit trail (doc §11.8, §15 rule 78: "every write to
-- net_cost_breakdown, markup_rule, sell_price, status, ... lead_manager_user_id
-- is mirrored into audit_logs"). Entity/entity_id is polymorphic so this one
-- table can back the Quote Details "Activity History" now and other admin
-- screens later without another migration per entity.
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  entity TEXT NOT NULL,
  entity_id UUID NOT NULL,
  field TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity, entity_id, created_at);
