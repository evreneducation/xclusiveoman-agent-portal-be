-- FD Package Day-by-day itinerary builder — brings FD packages onto the same
-- itinerary shape as the Custom FIT Package Builder / package-requests (see
-- 0030/0031_package_request_itinerary*.sql): a day's free-text notes plus its
-- assigned catalog items (hotel/tour/transfer/activity), each with its own
-- short per-item note. Previously fd_itinerary_days only held a single
-- free-text `description` per day with no catalog item selection at all.
ALTER TABLE fd_itinerary_days RENAME COLUMN description TO notes;

-- item_id is deliberately not a foreign key: item_type picks which of
-- hotels/tours/transfers/activities it points into, and Postgres has no
-- single-column polymorphic FK — same convention as
-- package_request_itinerary_items (0030_package_request_itinerary.sql).
-- Unlike a Custom FIT request, an FD package has no separate "agent
-- selection" step first, so any catalog item can be placed on any day.
CREATE TABLE fd_itinerary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_package_id UUID NOT NULL REFERENCES fd_packages(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('hotel', 'tour', 'transfer', 'activity')),
  item_id UUID NOT NULL,
  position INT NOT NULL DEFAULT 0,
  note TEXT
);

CREATE INDEX idx_fd_itinerary_items_package ON fd_itinerary_items(fd_package_id);
CREATE INDEX idx_fd_itinerary_items_day ON fd_itinerary_items(fd_package_id, day_number, position);
