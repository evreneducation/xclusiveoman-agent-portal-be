-- Content Hub "Oman Overview" — a cover photo shown on the agent-facing
-- card (ContentHub.jsx's OmanOverviewCard) in place of the plain PDF-icon
-- placeholder. Mandatory alongside name/description/pdf_url (0081), same
-- "always fully valid up front" posture — DEFAULT '' only so this ALTER
-- itself can't fail against any already-seeded rows; validation/schemas.js's
-- omanOverviewSchema is what actually enforces a real URL on every save.
ALTER TABLE oman_overviews ADD COLUMN cover_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE oman_overviews ALTER COLUMN cover_image_url DROP DEFAULT;
