CREATE TYPE agency_type AS ENUM ('travel_agent', 'mice_company');
CREATE TYPE agency_tier AS ENUM ('gold', 'silver', 'bronze');
CREATE TYPE agency_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');

CREATE TABLE agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type agency_type NOT NULL,
  license_number TEXT,
  country TEXT NOT NULL,
  tier agency_tier,
  status agency_status NOT NULL DEFAULT 'pending',
  credit_limit NUMERIC,
  currency_preference TEXT DEFAULT 'OMR',
  logo_asset_url TEXT,
  rm_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agencies_status ON agencies(status);
