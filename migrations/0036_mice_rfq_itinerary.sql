CREATE TABLE mice_rfq_itinerary_days (
  id CHAR(36) PRIMARY KEY,
  mice_rfq_id CHAR(36) NOT NULL,
  day_number INT NOT NULL,
  notes TEXT,
  CONSTRAINT fk_mice_rfq_itinerary_days_rfq FOREIGN KEY (mice_rfq_id) REFERENCES mice_rfqs(id) ON DELETE CASCADE,
  UNIQUE (mice_rfq_id, day_number)
);

CREATE TABLE mice_rfq_itinerary_items (
  id CHAR(36) PRIMARY KEY,
  mice_rfq_id CHAR(36) NOT NULL,
  day_number INT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('hotel', 'tour', 'transfer', 'activity')),
  item_id CHAR(36) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  note TEXT,
  CONSTRAINT fk_mice_rfq_itinerary_items_rfq FOREIGN KEY (mice_rfq_id) REFERENCES mice_rfqs(id) ON DELETE CASCADE
);

CREATE INDEX idx_mice_rfq_itinerary_days_rfq ON mice_rfq_itinerary_days(mice_rfq_id);
CREATE INDEX idx_mice_rfq_itinerary_items_rfq ON mice_rfq_itinerary_items(mice_rfq_id);
CREATE INDEX idx_mice_rfq_itinerary_items_day ON mice_rfq_itinerary_items(mice_rfq_id, day_number, position);
