-- item_id is deliberately not a foreign key: item_type picks which of
-- hotels/tours/transfers/activities it points into (a single-column
-- polymorphic reference), same as the original Postgres schema — application
-- code (packageRequests.model.js) is the source of truth for which pool an
-- item_type resolves against.
CREATE TABLE package_request_itinerary_days (
  id CHAR(36) PRIMARY KEY,
  package_request_id CHAR(36) NOT NULL,
  day_number INT NOT NULL,
  notes TEXT,
  CONSTRAINT fk_pr_itinerary_days_request FOREIGN KEY (package_request_id) REFERENCES package_requests(id) ON DELETE CASCADE,
  UNIQUE (package_request_id, day_number)
);

CREATE TABLE package_request_itinerary_items (
  id CHAR(36) PRIMARY KEY,
  package_request_id CHAR(36) NOT NULL,
  day_number INT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('hotel', 'tour', 'transfer', 'activity')),
  item_id CHAR(36) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_pr_itinerary_items_request FOREIGN KEY (package_request_id) REFERENCES package_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_pr_itinerary_days_request ON package_request_itinerary_days(package_request_id);
CREATE INDEX idx_pr_itinerary_items_request ON package_request_itinerary_items(package_request_id);
CREATE INDEX idx_pr_itinerary_items_day ON package_request_itinerary_items(package_request_id, day_number, position);
