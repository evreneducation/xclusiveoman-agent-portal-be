-- Admin's "Departure Dates & Inventory" panel (FD Package editor) gains a
-- Location dropdown per date (e.g. "Ex-Mumbai") instead of free text, so the
-- admin UI can offer a consistent picklist. Backed by a small master table
-- rather than an enum so it can be extended later without a migration.
CREATE TABLE departure_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fd_departure_dates ADD COLUMN location TEXT;

-- Seed with popular Indian cities (the agent-facing market this portal
-- currently serves) — admin can extend the list later.
INSERT INTO departure_locations (name) VALUES
  ('Mumbai'),
  ('Delhi'),
  ('Bengaluru'),
  ('Hyderabad'),
  ('Chennai'),
  ('Kolkata'),
  ('Pune'),
  ('Ahmedabad'),
  ('Jaipur'),
  ('Lucknow'),
  ('Kochi'),
  ('Chandigarh'),
  ('Goa'),
  ('Indore'),
  ('Surat')
ON CONFLICT (name) DO NOTHING;
