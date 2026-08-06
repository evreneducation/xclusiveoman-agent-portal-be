-- Draft Quotes (Agent Quote lifecycle item 1): "a partially completed
-- package should never be lost" — an agent can save a draft before ever
-- picking travel dates, so date_from/date_to can no longer be NOT NULL.
-- Still required at actual submit time by createPackageRequestSchema
-- (POST /package-requests and POST /package-requests/:id/submit), so this
-- only loosens the DB-level constraint the draft-only write path needs.
ALTER TABLE package_requests
  ALTER COLUMN date_from DROP NOT NULL,
  ALTER COLUMN date_to DROP NOT NULL;
