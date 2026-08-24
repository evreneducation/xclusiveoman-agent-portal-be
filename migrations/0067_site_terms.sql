-- Admin "Terms & Conditions" tab (new top-level sidebar item,
-- TermsAndConditions.jsx) — a single admin-authored rich-text policy
-- document, not a list: only one row is ever kept, same singleton
-- convention Visa (0051_visa_catalog.sql) already uses for its one flat
-- rate. Kept in its own dedicated table rather than folded into the
-- product-catalog tables (flights/hotels/etc.) — this isn't a bookable
-- product, it's site-wide policy content.
CREATE TABLE site_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body_html TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
