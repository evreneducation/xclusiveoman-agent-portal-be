ALTER TABLE oman_overviews ADD COLUMN cover_image_url TEXT NOT NULL DEFAULT ('');
ALTER TABLE oman_overviews ALTER COLUMN cover_image_url DROP DEFAULT;
