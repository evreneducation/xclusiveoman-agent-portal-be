-- Custom FIT Package Builder — Day-wise Itinerary Planner (FIT-5: "Itinerary
-- auto-build — Compiled day-by-day, drag-drop reorder"). Days are derived on
-- the fly from date_from/date_to (Day 1..N) rather than stored — only a day's
-- free-text notes and its assigned catalog items persist, both keyed by
-- day_number rather than a foreign key to a "days" row, so a day with
-- nothing on it yet needs no row at all.
--
-- item_id is deliberately not a foreign key: item_type picks which of
-- hotels/tours/transfers/activities it points into, and Postgres has no
-- single-column polymorphic FK. Application code (packageRequests.model.js)
-- is the source of truth for which pool an item_type resolves against.
CREATE TABLE package_request_itinerary_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_request_id UUID NOT NULL REFERENCES package_requests(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  notes TEXT,
  UNIQUE (package_request_id, day_number)
);

CREATE TABLE package_request_itinerary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_request_id UUID NOT NULL REFERENCES package_requests(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('hotel', 'tour', 'transfer', 'activity')),
  item_id UUID NOT NULL,
  position INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_pr_itinerary_days_request ON package_request_itinerary_days(package_request_id);
CREATE INDEX idx_pr_itinerary_items_request ON package_request_itinerary_items(package_request_id);
CREATE INDEX idx_pr_itinerary_items_day ON package_request_itinerary_items(package_request_id, day_number, position);
