CREATE TYPE fd_package_status AS ENUM ('draft', 'published', 'closed');

CREATE TABLE fd_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  theme TEXT,
  duration TEXT,
  hero_image_url TEXT,
  short_description TEXT,
  suitable_age_min INT,
  rating NUMERIC DEFAULT 0,
  review_count INT DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  status fd_package_status NOT NULL DEFAULT 'draft',
  deposit_amount NUMERIC,
  balance_due_days_before INT DEFAULT 30,
  rate_gold NUMERIC,
  rate_silver NUMERIC,
  rate_bronze NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fd_itinerary_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_package_id UUID NOT NULL REFERENCES fd_packages(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  description TEXT
);

CREATE TABLE fd_departure_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_package_id UUID NOT NULL REFERENCES fd_packages(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  seats_total INT NOT NULL DEFAULT 0,
  seats_booked INT NOT NULL DEFAULT 0
);

CREATE TABLE fd_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fd_package_id UUID NOT NULL REFERENCES fd_packages(id) ON DELETE CASCADE,
  activity_id UUID REFERENCES activities(id),
  tour_id UUID REFERENCES tours(id),
  price_per_pax NUMERIC NOT NULL,
  CHECK (
    (activity_id IS NOT NULL AND tour_id IS NULL) OR
    (activity_id IS NULL AND tour_id IS NOT NULL)
  )
);

CREATE INDEX idx_fd_departure_dates_package ON fd_departure_dates(fd_package_id);
CREATE INDEX idx_fd_addons_package ON fd_addons(fd_package_id);
