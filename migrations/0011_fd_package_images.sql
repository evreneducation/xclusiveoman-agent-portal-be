-- Carousel images for FD packages, distinct from hero_image_url (the single
-- card/hero shot). Populated via POST /admin/fd-packages/:id/images.
ALTER TABLE fd_packages ADD COLUMN images TEXT[] NOT NULL DEFAULT '{}';
