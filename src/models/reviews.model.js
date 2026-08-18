import { pool } from '../db/pool.js';

// Agent Review & Rating Popup (Task 20 — Screen 32, REV-1..4).
//
// --- "Last travel date" derivation (read this before touching the query
// below) --- fd_departure_dates has only a single `date` column (the
// departure/start date) — there is no trip end-date field anywhere in this
// schema, and fd_packages.duration is free text ("2N", "7N", "8D", or
// simply NULL for many real packages in this dataset), not reliably
// parseable into a day count. The one legitimate, non-invented source of
// real trip-length data is fd_itinerary_days.day_number (per-package,
// admin-authored). So: end_date = departure_date + (MAX(day_number) - 1)
// when itinerary days exist for that package; when they don't (common in
// this dataset — many packages have zero itinerary_days rows), this falls
// back to end_date = departure_date itself (a 1-day trip), which is the
// only defensible degrade-gracefully behavior without fabricating a
// duration. Documented as a known limitation in the Task 20 final report:
// a real multi-day trip whose package has no itinerary_days entered will
// be treated as ending on its departure date, which could make the popup
// eligible slightly earlier than the trip's true end.
const LAST_TRAVEL_DATE_EXPR = `(fdd.date + (COALESCE(MAX(fid.day_number), 1) - 1))`;

// Same "confirmed/successful" exclusion set Task 19's own analytics
// established (cancelled trips were never taken; waitlisted bookings never
// held a real confirmed seat) — reused here rather than inventing a new one.
const ELIGIBLE_BOOKING_STATUS_EXCLUSION = `b.status NOT IN ('cancelled', 'waitlisted')`;

// GET /reviews/pending-prompt — doc rule 76: "returns bookings where the
// last departure date is before today AND no reviews row exists yet —
// checked on every agent login." Extended with two things rule 76's own
// bare text doesn't cover (both explained above/at the migration): the
// dismiss-count cap, and the status exclusion.
export async function findEligibleBookingsForAgency(agencyId) {
  const { rows } = await pool.query(
    `SELECT
       b.id AS booking_id,
       b.fd_departure_date_id,
       b.review_prompt_dismiss_count,
       fdd.date AS departure_date,
       fdd.location,
       fp.id AS fd_package_id,
       fp.title AS package_title,
       fp.hero_image_url,
       fp.images,
       ${LAST_TRAVEL_DATE_EXPR} AS last_travel_date
     FROM bookings b
     JOIN fd_departure_dates fdd ON fdd.id = b.fd_departure_date_id
     JOIN fd_packages fp ON fp.id = fdd.fd_package_id
     LEFT JOIN fd_itinerary_days fid ON fid.fd_package_id = fp.id
     WHERE b.source_type = 'fd_package'
       AND b.agency_id = $1
       AND ${ELIGIBLE_BOOKING_STATUS_EXCLUSION}
       AND b.review_prompt_dismiss_count < 2
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)
     GROUP BY b.id, b.fd_departure_date_id, b.review_prompt_dismiss_count, fdd.date, fdd.location, fp.id, fp.title, fp.hero_image_url, fp.images
     HAVING ${LAST_TRAVEL_DATE_EXPR} < CURRENT_DATE
     ORDER BY fdd.date DESC`,
    [agencyId]
  );
  return rows;
}

// Ownership-scoped fetch for both the review-submit and dismiss endpoints —
// re-verifies agency_id server-side rather than trusting the :id in the
// URL, same posture as every other agent-facing booking lookup in this
// codebase (payments.controller.js#assertOwnsBooking, Task 14's own
// travelerDocumentsAgent.controller.js).
export async function findBookingForReview(bookingId, agencyId) {
  const { rows } = await pool.query(
    `SELECT
       b.*,
       fdd.date AS departure_date,
       fp.id AS fd_package_id,
       ${LAST_TRAVEL_DATE_EXPR} AS last_travel_date
     FROM bookings b
     JOIN fd_departure_dates fdd ON fdd.id = b.fd_departure_date_id
     JOIN fd_packages fp ON fp.id = fdd.fd_package_id
     LEFT JOIN fd_itinerary_days fid ON fid.fd_package_id = fp.id
     WHERE b.id = $1 AND b.agency_id = $2 AND b.source_type = 'fd_package'
     GROUP BY b.id, fdd.date, fp.id`,
    [bookingId, agencyId]
  );
  return rows[0] || null;
}

export async function findReviewByBookingId(bookingId) {
  const { rows } = await pool.query('SELECT * FROM reviews WHERE booking_id = $1', [bookingId]);
  return rows[0] || null;
}

// Rating is required, review_text optional (doc §9.10 step 49: "rates and
// OPTIONALLY writes a review") — status always starts 'needs_review',
// never settable by the agent (Item 33's own moderation job, out of scope
// here). The reviews.booking_id UNIQUE constraint is the real
// duplicate-submission guard; this INSERT will throw a Postgres
// unique_violation (23505) if a review already exists, which the
// controller maps to a clean 409.
export async function createReview({ bookingId, fdPackageId, agencyId, rating, reviewText }) {
  const { rows } = await pool.query(
    `INSERT INTO reviews (booking_id, fd_package_id, agency_id, rating, review_text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [bookingId, fdPackageId, agencyId, rating, reviewText || null]
  );
  return rows[0];
}

// POST /bookings/:id/dismiss-review-prompt — atomic increment, ownership-
// scoped in the same WHERE clause (never a separate read-then-write).
export async function incrementDismissCount(bookingId, agencyId) {
  const { rows } = await pool.query(
    `UPDATE bookings SET review_prompt_dismiss_count = review_prompt_dismiss_count + 1, updated_at = now()
     WHERE id = $1 AND agency_id = $2
     RETURNING *`,
    [bookingId, agencyId]
  );
  return rows[0] || null;
}
