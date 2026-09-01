-- Admin sidebar "Deals" tab — admin-uploaded promo card photos for the agent
-- dashboard's "Deals For You" carousel (agent/pages/Dashboard.jsx's own
-- PLACEHOLDER_DEAL, swapped out for this once real content exists). A
-- growable list, like oman_overviews (0081) — any number of entries, no
-- draft state (title/image_url required up front; duration is optional,
-- see validation/schemas.js's dealSchema).
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  duration TEXT,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
