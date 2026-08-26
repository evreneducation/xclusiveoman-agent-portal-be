-- 0070_hotels_status.sql relaxed hotelSchema (Zod) so a draft hotel can be
-- created/patched with only some fields — but the underlying columns still
-- had their original NOT NULL constraints (0005_catalog.sql, long before
-- draft/publish existed), so the very first autosave (typically just `name`
-- typed so far) failed at the database with "null value in column city
-- violates not-null constraint". Drop both, matching every other
-- required-only-at-publish column here (state/address/email/description are
-- already nullable) — completeness is enforced by requireHotelPublishFields
-- (catalog.routes.js) at publish time, not by the schema.
ALTER TABLE hotels ALTER COLUMN name DROP NOT NULL;
ALTER TABLE hotels ALTER COLUMN city DROP NOT NULL;
