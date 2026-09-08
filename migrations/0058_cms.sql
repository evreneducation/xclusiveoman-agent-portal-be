-- slug is VARCHAR (not TEXT) since it carries a UNIQUE constraint — MySQL/
-- InnoDB requires a bounded key length for indexed columns.
CREATE TABLE cms_pages (
  id CHAR(36) PRIMARY KEY,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  body_html TEXT,
  status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cms_pages_section ON cms_pages(section(255));
CREATE INDEX idx_cms_pages_status ON cms_pages(status);

CREATE TABLE media_library (
  id CHAR(36) PRIMARY KEY,
  url TEXT NOT NULL,
  alt_text TEXT,
  uploaded_by_user_id CHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_media_library_uploaded_by FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);
