CREATE TABLE hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  category INT,
  board_basis_options TEXT[] DEFAULT '{}',
  mice_ballroom_capacity INT,
  mice_breakout_rooms INT,
  images TEXT[] DEFAULT '{}',
  description TEXT,
  is_mice_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT,
  duration TEXT,
  images TEXT[] DEFAULT '{}',
  group_suitability TEXT,
  rating NUMERIC DEFAULT 0,
  review_count INT DEFAULT 0,
  suitable_age_min INT,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  description TEXT,
  duration TEXT,
  images TEXT[] DEFAULT '{}',
  price_per_pax NUMERIC,
  rating NUMERIC DEFAULT 0,
  review_count INT DEFAULT 0,
  suitable_age_min INT,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE transfer_type AS ENUM ('airport', 'intercity', 'point_to_point', 'group_coach');

CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type transfer_type NOT NULL,
  vehicle_class TEXT,
  city TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  images TEXT[] DEFAULT '{}',
  suitable_group_size_min INT,
  suitable_group_size_max INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
