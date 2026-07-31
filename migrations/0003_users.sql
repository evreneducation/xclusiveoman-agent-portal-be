CREATE TYPE user_role AS ENUM (
  'agency_owner',
  'agency_staff',
  'ops_admin',
  'super_admin',
  'sales_marketing',
  'support',
  'finance'
);
CREATE TYPE user_status AS ENUM ('active', 'disabled');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  whatsapp_number TEXT,
  password_hash TEXT NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_agency_id ON users(agency_id);
CREATE INDEX idx_users_role ON users(role);

ALTER TABLE agencies
  ADD CONSTRAINT fk_agencies_rm_user FOREIGN KEY (rm_user_id) REFERENCES users(id);
