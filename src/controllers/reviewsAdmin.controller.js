import { listReviewsForAdmin, findReviewByIdForAdmin, setReviewStatus } from '../models/reviewsAdmin.model.js';
import { insertAuditLog } from '../models/auditLogs.model.js';

// Admin Reviews Management (Task 21 — Item 33, Screen 33, REV-3/REV-4).
// Mounted at /admin/reviews, gated requireRole('ops_admin','super_admin')
// (see reviewsAdmin.routes.js) — narrower than STAFF_ROLES on purpose, per
// this task's explicit instruction (moderation isn't automatically a
// finance/support/marketing concern).

function toPublicReview(r) {
  return {
    id: r.id,
    bookingId: r.booking_id,
    agencyId: r.agency_id,
    agencyName: r.agency_name,
    fdPackageId: r.fd_package_id,
    packageTitle: r.package_title,
    rating: r.rating,
    reviewText: r.review_text,
    status: r.status,
    submittedAt: r.submitted_at,
  };
}

// GET /api/admin/reviews?status=&rating=&search=&page=&pageSize=
export async function listReviews(req, res, next) {
  try {
    const { status, rating, search, page, pageSize } = req.query;
    const { rows, total, page: currentPage, pageSize: limit } = await listReviewsForAdmin({
      status,
      rating,
      search,
      page,
      pageSize,
    });

    res.json({
      rows: rows.map(toPublicReview),
      total,
      page: currentPage,
      pageSize: limit,
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/admin/reviews/:id — { status: 'published' | 'hidden' }.
// Validated to exactly those two values at the route layer
// (validateBody(updateReviewStatusSchema)) — REV-3 is "publish/hide" only,
// 'needs_review' is never an admin-settable target.
export async function updateReviewStatus(req, res, next) {
  try {
    const result = await setReviewStatus(req.params.id, req.body.status);
    if (!result) return res.status(404).json({ error: 'not_found' });

    // §16: "All monetary and status-changing admin actions are written to
    // audit_logs." Only logged when the status actually changed — an
    // already-published review re-published is a no-op, not a real event,
    // per this task's own "avoid a meaningless duplicate" instruction.
    // Never logs review_text/rating or any other field — just the status
    // transition itself, no sensitive payload.
    if (result.changed) {
      await insertAuditLog({
        actorUserId: req.user.id,
        entity: 'review',
        entityId: result.review.id,
        field: 'status',
        oldValue: result.previousStatus,
        newValue: result.review.status,
      });
    }

    // toPublicReview expects agency_name/package_title (joined columns) —
    // setReviewStatus's UPDATE ... RETURNING * only has the bare reviews
    // columns, so re-fetch the joined shape for a consistent response.
    const withJoins = await findReviewByIdForAdmin(result.review.id);
    res.json({ review: toPublicReview(withJoins) });
  } catch (err) {
    next(err);
  }
}
