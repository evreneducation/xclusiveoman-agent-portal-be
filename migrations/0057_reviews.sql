CREATE TABLE reviews (
  id CHAR(36) PRIMARY KEY,
  booking_id CHAR(36) NOT NULL UNIQUE,
  fd_package_id CHAR(36) NOT NULL,
  agency_id CHAR(36) NOT NULL,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,
  status ENUM('published', 'needs_review', 'hidden') NOT NULL DEFAULT 'needs_review',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_reviews_fd_package FOREIGN KEY (fd_package_id) REFERENCES fd_packages(id),
  CONSTRAINT fk_reviews_agency FOREIGN KEY (agency_id) REFERENCES agencies(id)
);

CREATE INDEX idx_reviews_fd_package ON reviews(fd_package_id);
CREATE INDEX idx_reviews_status ON reviews(status);

ALTER TABLE bookings ADD COLUMN review_prompt_dismiss_count INT NOT NULL DEFAULT 0;
