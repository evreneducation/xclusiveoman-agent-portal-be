-- Agent Review & Rating Popup (Task 20 — Screen 32, REV-1..4). Schema per
-- the documentation's own ERD (§11.6/§11.8) verbatim:
--   reviews (id, booking_id, fd_package_id, agency_id,
--     rating INT CHECK (rating BETWEEN 1 AND 5), review_text TEXT,
--     status ENUM(published, needs_review, hidden), submitted_at TIMESTAMPTZ)
-- "bookings 1--1 reviews" (doc §11.9) — enforced here with UNIQUE on
-- booking_id, which also doubles as the database-level duplicate-submission
-- guard the task explicitly asked for (not just an application-level check).
-- review_text is nullable — the doc's own workflow (step 49) says the agent
-- "rates and OPTIONALLY writes a review", only rating is mandatory.
-- status defaults to 'needs_review' (not 'published') — Item 33 (Admin
-- Reviews Management, explicitly out of scope for this task) is what will
-- publish/hide it; a freshly-submitted review must never be exposed as a
-- public package rating before that moderation step, per this task's own
-- "do not expose unpublished reviews" instruction.
CREATE TYPE review_status AS ENUM ('published', 'needs_review', 'hidden');

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id),
  fd_package_id UUID NOT NULL REFERENCES fd_packages(id),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  status review_status NOT NULL DEFAULT 'needs_review',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_fd_package ON reviews(fd_package_id);
-- For Item 33's future moderation queue (GET/PATCH /admin/reviews) — not
-- used by this task, added now since it costs nothing and the column
-- already exists.
CREATE INDEX idx_reviews_status ON reviews(status);

-- Doc rule 76's own eligibility check ("no reviews row exists yet") already
-- naturally stops the popup once a review is submitted — no extra state
-- needed for that path. But a *dismissed-without-reviewing* booking still
-- has no reviews row, so rule 76's bare check alone would show it as
-- eligible forever, contradicting the Screen 32 wireframe's own "reappears
-- once more before going silent." This one small counter is the minimum
-- state needed to cap that at two showings — a single column on the
-- already-1--1-scoped bookings row (same minimal-footprint choice as
-- Task 12/14's own booking-level flags, e.g. bookings.documents_notified_at),
-- not a new table.
ALTER TABLE bookings ADD COLUMN review_prompt_dismiss_count INT NOT NULL DEFAULT 0;
