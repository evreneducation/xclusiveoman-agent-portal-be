-- Admin Content & CMS Management (Task 21 — Item 34, Screen 34, CMS-1..3).
-- Schema per the documentation's own ERD (§11.8) verbatim:
--   cms_pages (id, title, section TEXT, slug TEXT UNIQUE, body_html TEXT,
--     status ENUM(draft, published))
--   media_library (id, url TEXT, alt_text TEXT, uploaded_by_user_id UUID)
-- No undocumented fields added (no SEO/author/tags/ordering/scheduling
-- columns — see the audit's own ambiguity notes on CMS-2's "with scheduling"
-- having no ERD support). created_at/updated_at added to both tables to
-- match this codebase's universal convention (every other top-level table
-- has both — see e.g. 0057_reviews.sql, 0005_catalog.sql); the wireframe's
-- own "Last updated" column is what updated_at is for.
--
-- section stays a bare TEXT column, not an enum — CMS-1/CMS-2's three
-- documented content groupings (Oman overview pages, homepage banners,
-- guides/blog) are an admin-UI-level grouping, not a fixed vocabulary the
-- doc ever formalizes into a schema constraint (mirrors how catalog.section
-- equivalents elsewhere in this doc, e.g. transfers.type, ARE enums when the
-- doc actually specifies one — it doesn't here).
--
-- uploaded_by_user_id references users(id) — the only staff/user table in
-- this schema (0003_users.sql); ON DELETE SET NULL rather than CASCADE or
-- RESTRICT, since an uploaded asset shouldn't vanish or block a user record
-- from ever being removed just because they once uploaded a CMS image.
CREATE TYPE cms_page_status AS ENUM ('draft', 'published');

CREATE TABLE cms_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  body_html TEXT,
  status cms_page_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cms_pages_section ON cms_pages(section);
CREATE INDEX idx_cms_pages_status ON cms_pages(status);

CREATE TABLE media_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  alt_text TEXT,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
