import { pool } from '../db/pool.js';

// Admin Analytics & Reporting (Task 19 — Screen 18, ANL-1). FD-only, same
// scoping every prior admin feature in this codebase has used since Task 13
// (source_type = 'fd_package' is the only booking source that actually
// exists — see bookingsAdmin.model.js's own comment).
//
// --- Revenue definition (read this before touching any query below) ---
// "Recognized revenue" = SUM(bookings.deposit_paid), never
// SUM(transactions.amount). Both revenue-recognition paths in this codebase
// keep bookings.deposit_paid correctly up to date:
//   - Self-service: paymentConfirmation.service.js#confirmPayment increments
//     it AND inserts a `transactions` row (real Cashfree webhook success or
//     an admin-approved NEFT slip only — never a guess).
//   - Manual admin bookings (Task 13): booking.service.js#createFdBooking
//     sets it directly at creation time from an admin-entered offline
//     deposit, WITHOUT ever inserting a `transactions` row (Task 13
//     deliberately never fabricates a payments/transactions record for that
//     path — see its own comments).
// Summing `transactions.amount` instead would silently under-count every
// manual booking's deposit. Deliberately using bookings.deposit_paid
// EXCLUSIVELY (never also summing transactions) is what avoids
// double-counting the same money through two sources.
//
// "Confirmed/successful" scope: every query below excludes bookings with
// status IN ('cancelled', 'waitlisted') from revenue (not from booking
// counts) — a cancelled booking's historical deposit isn't ongoing
// recognized revenue, and a waitlisted booking was never confirmed against
// a real seat. This codebase has no refund-reversal mechanism, so this
// status exclusion is the only available, non-invented way to scope
// "successful" records.
const REVENUE_STATUS_EXCLUSION = `b.status NOT IN ('cancelled', 'waitlisted')`;

function buildAgencyFilters({ agencyId, tier, country }, startIndex) {
  const clauses = [];
  const values = [];
  let i = startIndex;
  if (agencyId) {
    clauses.push(`b.agency_id = $${i}`);
    values.push(agencyId);
    i += 1;
  }
  if (tier) {
    clauses.push(`a.tier = $${i}`);
    values.push(tier);
    i += 1;
  }
  if (country) {
    clauses.push(`a.country = $${i}`);
    values.push(country);
    i += 1;
  }
  return { clause: clauses.length ? `AND ${clauses.join(' AND ')}` : '', values, next: i };
}

function buildDateFilters({ dateFrom, dateTo }, startIndex) {
  const clauses = [];
  const values = [];
  let i = startIndex;
  if (dateFrom) {
    clauses.push(`b.created_at >= $${i}`);
    values.push(dateFrom);
    i += 1;
  }
  if (dateTo) {
    // Inclusive of the whole end day, same convention packageRequestsAdmin.model.js uses.
    clauses.push(`b.created_at < ($${i}::date + interval '1 day')`);
    values.push(dateTo);
    i += 1;
  }
  return { clause: clauses.length ? `AND ${clauses.join(' AND ')}` : '', values, next: i };
}

// GET /admin/analytics/summary — KPI cards + sales mix. Only the FD-only,
// source_type-scoped bookings table is touched (JOIN agencies for
// tier/country filtering); source_type = 'fd_package' is filtered exactly
// like every other admin analytics-adjacent query in this codebase.
export async function getSummary({ dateFrom, dateTo, agencyId, tier, country } = {}) {
  const dateFilters = buildDateFilters({ dateFrom, dateTo }, 1);
  const agencyFilters = buildAgencyFilters({ agencyId, tier, country }, dateFilters.next);
  const values = [...dateFilters.values, ...agencyFilters.values];
  const where = `WHERE b.source_type = 'fd_package' ${dateFilters.clause} ${agencyFilters.clause}`;

  const { rows: totals } = await pool.query(
    `SELECT
       COUNT(*)::int AS total_bookings,
       COALESCE(SUM(b.deposit_paid) FILTER (WHERE ${REVENUE_STATUS_EXCLUSION}), 0) AS total_revenue,
       COUNT(*) FILTER (WHERE ${REVENUE_STATUS_EXCLUSION} AND b.deposit_paid > 0)::int AS revenue_booking_count
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     ${where}`,
    values
  );

  // Sales mix — bookings.created_via (self_service vs manual_admin), per
  // this file's own top comment on why this dimension was chosen over
  // transaction.method (incomplete for manual bookings) or source_type
  // (always 'fd_package' today, so not a meaningful "mix" at all).
  const { rows: salesMixRows } = await pool.query(
    `SELECT
       b.created_via,
       COUNT(*)::int AS booking_count,
       COALESCE(SUM(b.deposit_paid) FILTER (WHERE ${REVENUE_STATUS_EXCLUSION}), 0) AS revenue
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     ${where}
     GROUP BY b.created_via`,
    values
  );

  // Total agencies — snapshot of approved agencies, date-filtered by their
  // own created_at when a range is given (same range, applied to a
  // different table's own timestamp — agencies has no relationship to
  // bookings.created_at).
  const agencyDateClauses = [];
  const agencyDateValues = [];
  let ai = 1;
  if (dateFrom) {
    agencyDateClauses.push(`created_at >= $${ai}`);
    agencyDateValues.push(dateFrom);
    ai += 1;
  }
  if (dateTo) {
    agencyDateClauses.push(`created_at < ($${ai}::date + interval '1 day')`);
    agencyDateValues.push(dateTo);
    ai += 1;
  }
  const agencyWhere = ['status = \'approved\'', ...agencyDateClauses].join(' AND ');
  const { rows: agencyRows } = await pool.query(`SELECT COUNT(*)::int AS total_agencies FROM agencies WHERE ${agencyWhere}`, agencyDateValues);

  const totalRevenue = Number(totals[0].total_revenue);
  const totalBookings = totals[0].total_bookings;
  const revenueBookingCount = totals[0].revenue_booking_count;

  return {
    totalBookings,
    totalRevenue,
    averageBookingValue: revenueBookingCount > 0 ? totalRevenue / revenueBookingCount : 0,
    totalAgencies: agencyRows[0].total_agencies,
    // Profit margin is deliberately never computed — see this file's own
    // header comment / analytics.controller.js's own comment for why no
    // cost-basis field exists anywhere in this schema for FD bookings.
    profitMargin: {
      available: false,
      reason: 'FD packages have no reliable cost-basis field in the current schema — only the sell price (rate_per_pax) is stored, never an admin-entered net cost. Profit margin cannot be calculated without inventing a cost figure, so it is intentionally omitted rather than shown as a fabricated percentage.',
    },
    salesMix: salesMixRows.map((r) => ({
      createdVia: r.created_via,
      bookingCount: r.booking_count,
      revenue: Number(r.revenue),
    })),
  };
}

// GET /admin/analytics/revenue-by-month — one row per calendar month in
// [dateFrom, dateTo], zero-filled so the chart never has a gap for a month
// with no bookings. generate_series + LEFT JOIN, not a JS loop patching
// gaps — the zero-fill itself is server-side aggregation too.
export async function getRevenueByMonth({ dateFrom, dateTo, agencyId, tier, country }) {
  const agencyFilters = buildAgencyFilters({ agencyId, tier, country }, 3);
  const values = [dateFrom, dateTo, ...agencyFilters.values];

  const { rows } = await pool.query(
    `WITH months AS (
       SELECT generate_series(date_trunc('month', $1::date), date_trunc('month', $2::date), interval '1 month') AS month_start
     ),
     revenue AS (
       SELECT
         date_trunc('month', b.created_at) AS month_start,
         COALESCE(SUM(b.deposit_paid) FILTER (WHERE ${REVENUE_STATUS_EXCLUSION}), 0) AS revenue,
         COUNT(*)::int AS booking_count
       FROM bookings b
       JOIN agencies a ON a.id = b.agency_id
       WHERE b.source_type = 'fd_package'
         AND b.created_at >= $1::date
         AND b.created_at < ($2::date + interval '1 day')
         ${agencyFilters.clause}
       GROUP BY 1
     )
     SELECT m.month_start, COALESCE(r.revenue, 0) AS revenue, COALESCE(r.booking_count, 0)::int AS booking_count
     FROM months m
     LEFT JOIN revenue r ON r.month_start = m.month_start
     ORDER BY m.month_start`,
    values
  );

  return rows.map((r) => ({ month: r.month_start, revenue: Number(r.revenue), bookingCount: r.booking_count }));
}

// GET /admin/analytics/top-agencies — ranked by recognized revenue, ties
// broken by booking count. SQL-side ORDER BY + LIMIT/OFFSET — never fetch
// every agency and sort in JS.
export async function getTopAgencies({ dateFrom, dateTo, agencyId, tier, country, page, pageSize } = {}) {
  const dateFilters = buildDateFilters({ dateFrom, dateTo }, 1);
  const agencyFilters = buildAgencyFilters({ agencyId, tier, country }, dateFilters.next);
  const values = [...dateFilters.values, ...agencyFilters.values];
  const where = `WHERE b.source_type = 'fd_package' ${dateFilters.clause} ${agencyFilters.clause}`;

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(DISTINCT a.id) AS count
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     ${where}`,
    values
  );
  const total = Number(countRows[0].count);

  const limit = Math.max(1, Math.min(100, Number(pageSize) || 10));
  const currentPage = Math.max(1, Number(page) || 1);
  const offset = (currentPage - 1) * limit;

  const { rows } = await pool.query(
    `SELECT
       a.id AS agency_id,
       a.name AS agency_name,
       a.tier,
       a.country,
       COUNT(*)::int AS booking_count,
       COALESCE(SUM(b.deposit_paid) FILTER (WHERE ${REVENUE_STATUS_EXCLUSION}), 0) AS revenue
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     ${where}
     GROUP BY a.id, a.name, a.tier, a.country
     ORDER BY revenue DESC, booking_count DESC
     LIMIT $${agencyFilters.next} OFFSET $${agencyFilters.next + 1}`,
    [...values, limit, offset]
  );

  return {
    rows: rows.map((r) => ({
      agencyId: r.agency_id,
      agencyName: r.agency_name,
      tier: r.tier,
      country: r.country,
      bookingCount: r.booking_count,
      revenue: Number(r.revenue),
    })),
    total,
    page: currentPage,
    pageSize: limit,
  };
}
