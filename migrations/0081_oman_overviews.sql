-- Content Hub "Oman Overview" — admin-uploaded PDF documents paired with a
-- substantial written overview (500+ words, enforced in
-- validation/schemas.js's omanOverviewSchema, not at the DB layer). Shows up
-- first in both MiceCatalog.jsx's tab list and the agent portal's Content
-- Hub (ContentHub.jsx). A growable list, like flights — any number of
-- entries, no draft state (name/description/pdf_url are all required
-- up front, same "always fully valid" posture flightSchema already uses).
CREATE TABLE oman_overviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  pdf_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
