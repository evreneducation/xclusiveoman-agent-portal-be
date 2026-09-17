const {
  findEligibleBookingsForAgency,
  findBookingForReview,
  findReviewByBookingId,
  createReview,
  incrementDismissCount
} = require('../models/reviews.model.js');

const {
  insertAuditLog
} = require('../models/auditLogs.model.js');

// Agent Review & Rating Popup (Task 20 — Screen 32, REV-1..4). Mounted
// partly on the existing bookings.routes.js router (booking-scoped actions:
// submit/dismiss — same file Task 14's traveler-document routes already
// live on) and partly on a new top-level reviews.routes.js (the
// not-booking-scoped pending-prompt list), matching the doc's own bare
// GET /reviews/pending-prompt route naming.

function toPublicPrompt(row) {
  return {
    bookingId: row.booking_id,
    fdPackageId: row.fd_package_id,
    packageTitle: row.package_title,
    heroImageUrl: row.hero_image_url,
    images: row.images || [],
    departureDate: row.departure_date,
    lastTravelDate: row.last_travel_date,
    location: row.location,
    // Lets the frontend label the dismiss button accurately — eligibility
    // already guarantees this is 0 or 1 (>= 2 is excluded from the query),
    // so 1 means this showing is the final one before it goes silent.
    dismissCount: row.review_prompt_dismiss_count,
  };
}

async function listPendingPrompts(req, res, next) {
  try {
    const rows = await findEligibleBookingsForAgency(req.user.agency_id);
    res.json({ prompts: rows.map(toPublicPrompt) });
  } catch (err) {
    next(err);
  }
}

module.exports.listPendingPrompts = listPendingPrompts;

async function submitReview(req, res, next) {
  try {
    const booking = await findBookingForReview(req.params.id, req.user.agency_id);
    if (!booking) return res.status(404).json({ error: 'not_found' });

    if (booking.status === 'cancelled' || booking.status === 'waitlisted') {
      return res.status(400).json({ error: 'not_eligible', message: 'This booking is not eligible for a review.' });
    }

    const lastTravelDate = new Date(booking.last_travel_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (lastTravelDate >= today) {
      return res.status(400).json({
        error: 'trip_not_completed',
        message: 'This trip has not finished yet — reviews can only be submitted after the travel dates have passed.',
      });
    }

    const existing = await findReviewByBookingId(booking.id);
    if (existing) {
      return res.status(409).json({ error: 'already_reviewed', message: 'A review has already been submitted for this booking.' });
    }

    const { rating, reviewText } = req.body;
    const review = await createReview({
      bookingId: booking.id,
      fdPackageId: booking.fd_package_id,
      agencyId: req.user.agency_id,
      rating,
      reviewText,
    });

    await insertAuditLog({
      actorUserId: req.user.id,
      entity: 'booking',
      entityId: booking.id,
      field: 'review_submitted',
      newValue: { rating, hasReviewText: !!reviewText },
    });

    res.status(201).json({
      review: {
        id: review.id,
        bookingId: review.booking_id,
        rating: review.rating,
        reviewText: review.review_text,
        status: review.status,
        submittedAt: review.submitted_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports.submitReview = submitReview;

async function dismissReviewPrompt(req, res, next) {
  try {
    const updated = await incrementDismissCount(req.params.id, req.user.agency_id);
    if (!updated) return res.status(404).json({ error: 'not_found' });

    res.json({ bookingId: updated.id, dismissCount: updated.review_prompt_dismiss_count });
  } catch (err) {
    next(err);
  }
}

module.exports.dismissReviewPrompt = dismissReviewPrompt;
