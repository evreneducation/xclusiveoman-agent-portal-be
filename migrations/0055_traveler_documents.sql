-- Admin Client Documents & Visa Processing (Task 14 — Screen 23, DOC-1..6).
-- Schema follows the documentation's own ERD almost verbatim (§11.6):
--   traveler_documents (id, booking_traveler_id, passport_scan_url,
--     passport_photo_url, visa_copy_url, uploaded_by_agent_at,
--     visa_uploaded_by_admin_at)
--   booking_vouchers (id, booking_id, voucher_url, uploaded_at)
-- "1--1" (doc §11.9: "bookings 1--N booking_travelers 1--1 traveler_documents")
-- — one row per traveler holding all three document URLs as plain columns,
-- not a generic polymorphic multi-row documents table. A re-upload simply
-- overwrites the relevant URL column (the schema has no room for keeping
-- history of prior uploads); audit_logs is what preserves the "who/when"
-- trail across overwrites, matching this table's own restraint (no
-- uploaded_by_user_id here — both an agent and admin write to the same row,
-- for different columns, so a single uploader column would be ambiguous;
-- the two *_at timestamps already record "was this ever touched by that
-- role", which is all this table itself needs to know).
CREATE TABLE traveler_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_traveler_id UUID NOT NULL UNIQUE REFERENCES booking_travelers(id) ON DELETE CASCADE,
  passport_scan_url TEXT,
  passport_photo_url TEXT,
  visa_copy_url TEXT,
  -- Set (and re-set) whenever the agent uploads/re-uploads either passport
  -- field — "has the agent touched this traveler's documents, and when
  -- most recently" rather than one timestamp per field, matching the doc's
  -- own single-column choice here.
  uploaded_by_agent_at TIMESTAMPTZ,
  -- Set when admin uploads visa_copy_url — this is the one half of the
  -- doc's own unlock condition (§15 rule 77) that lives per-traveler; the
  -- other half (a booking_vouchers row existing) is booking-level, see below.
  visa_uploaded_by_admin_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_traveler_documents_traveler ON traveler_documents(booking_traveler_id);

-- One voucher per booking (not per traveler — DOC-5 is explicit: "the
-- booking voucher", singular, and the doc's own ERD scopes this to
-- booking_id, not booking_traveler_id). uploaded_by_user_id is a small,
-- deliberate addition beyond the doc's bare ERD listing: unlike
-- traveler_documents above, this table is never written by more than one
-- role (admin only), so there's no ambiguity in recording who.
CREATE TABLE booking_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  voucher_url TEXT NOT NULL,
  uploaded_by_user_id UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_vouchers_booking ON booking_vouchers(booking_id);

-- The one piece of §15 rule 77's unlock condition the doc's ERD doesn't
-- already name a home for: "...and admin has explicitly clicked Notify
-- Agent." A single explicit, one-time, booking-level action (DOC-6) — same
-- "first-time-only timestamp on the parent row" shape already established
-- by fd_departure_operations' own stage columns (Task 12) and Marketing's
-- campaign-recipient tracking, not a new table for one flag. NULL = agent's
-- admin-uploaded (visa/voucher) downloads stay locked; once set, they
-- unlock. The agent's own passport/photo uploads are never gated by this —
-- see the Task 14 controllers' own comments on why.
ALTER TABLE bookings ADD COLUMN documents_notified_at TIMESTAMPTZ;
