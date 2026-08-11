-- MICE Curation Day-wise Itinerary Planner — brings the Agent MICE Builder
-- onto the same day-wise itinerary model the Custom FIT Package Builder
-- already uses (see 0030/0031_package_request_itinerary*.sql): a day's
-- free-text notes plus its assigned catalog items (hotel/tour/transfer/
-- activity), each with its own short per-item note. Days are virtual (Day
-- 1..N derived from event_date_from/event_date_to by the caller, same as
-- package_requests' date_from/date_to) rather than stored — only a day's
-- notes and its assigned items persist, and only for days that actually
-- have something on them.
--
-- Unlike fd_itinerary_items (0034), items here reference the mice_rfq's own
-- *already-selected* hotels/tours/transfers/activities (mice_rfq_hotels
-- etc.) — the agent still picks catalog items via those existing tables (up
-- to 3 hotels, MICE-2/MICE-7) and this table only arranges that same
-- selection into days, matching package_request_itinerary_items exactly.
CREATE TABLE mice_rfq_itinerary_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mice_rfq_id UUID NOT NULL REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  notes TEXT,
  UNIQUE (mice_rfq_id, day_number)
);

-- item_id is deliberately not a foreign key: item_type picks which of
-- hotels/tours/transfers/activities it points into, and Postgres has no
-- single-column polymorphic FK — same convention as
-- package_request_itinerary_items.
CREATE TABLE mice_rfq_itinerary_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mice_rfq_id UUID NOT NULL REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('hotel', 'tour', 'transfer', 'activity')),
  item_id UUID NOT NULL,
  position INT NOT NULL DEFAULT 0,
  note TEXT
);

CREATE INDEX idx_mice_rfq_itinerary_days_rfq ON mice_rfq_itinerary_days(mice_rfq_id);
CREATE INDEX idx_mice_rfq_itinerary_items_rfq ON mice_rfq_itinerary_items(mice_rfq_id);
CREATE INDEX idx_mice_rfq_itinerary_items_day ON mice_rfq_itinerary_items(mice_rfq_id, day_number, position);
