const {
  pool
} = require('../db/pool.js');

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

// Placeholders are plain `?` under MySQL (positional, not numbered like
// Postgres's $1/$2), so unlike the original these helpers no longer need to
// thread a startIndex/next counter through the caller — clause order and
// values-array push order just have to match, which they already do
// everywhere these are used (clause is always interpolated in the same
// order its values were pushed).
function buildAgencyFilters({ agencyId, country }) {
  const clauses = [];
  const values = [];
  if (agencyId) {
    clauses.push(`b.agency_id = ?`);
    values.push(agencyId);
  }
  if (country) {
    clauses.push(`a.country = ?`);
    values.push(country);
  }
  return { clause: clauses.length ? `AND ${clauses.join(' AND ')}` : '', values };
}

function buildDateFilters({ dateFrom, dateTo }) {
  const clauses = [];
  const values = [];
  if (dateFrom) {
    clauses.push(`b.created_at >= ?`);
    values.push(dateFrom);
  }
  if (dateTo) {
    // Inclusive of the whole end day, same convention packageRequestsAdmin.model.js uses.
    clauses.push(`b.created_at < (? + INTERVAL 1 DAY)`);
    values.push(dateTo);
  }
  return { clause: clauses.length ? `AND ${clauses.join(' AND ')}` : '', values };
}

async function getSummary({ dateFrom, dateTo, agencyId, country } = {}) {
  const dateFilters = buildDateFilters({ dateFrom, dateTo });
  const agencyFilters = buildAgencyFilters({ agencyId, country });
  const values = [...dateFilters.values, ...agencyFilters.values];
  const where = `WHERE b.source_type = 'fd_package' ${dateFilters.clause} ${agencyFilters.clause}`;

  const { rows: totals } = await pool.query(
    `SELECT
       COUNT(*) AS total_bookings,
       COALESCE(SUM(CASE WHEN ${REVENUE_STATUS_EXCLUSION} THEN b.deposit_paid ELSE 0 END), 0) AS total_revenue,
       COUNT(CASE WHEN ${REVENUE_STATUS_EXCLUSION} AND b.deposit_paid > 0 THEN 1 END) AS revenue_booking_count
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
       COUNT(*) AS booking_count,
       COALESCE(SUM(CASE WHEN ${REVENUE_STATUS_EXCLUSION} THEN b.deposit_paid ELSE 0 END), 0) AS revenue
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
  if (dateFrom) {
    agencyDateClauses.push(`created_at >= ?`);
    agencyDateValues.push(dateFrom);
  }
  if (dateTo) {
    agencyDateClauses.push(`created_at < (? + INTERVAL 1 DAY)`);
    agencyDateValues.push(dateTo);
  }
  const agencyWhere = ['status = \'approved\'', ...agencyDateClauses].join(' AND ');
  const { rows: agencyRows } = await pool.query(`SELECT COUNT(*) AS total_agencies FROM agencies WHERE ${agencyWhere}`, agencyDateValues);

  const totalRevenue = Number(totals[0].total_revenue);
  const totalBookings = Number(totals[0].total_bookings);
  const revenueBookingCount = Number(totals[0].revenue_booking_count);

  return {
    totalBookings,
    totalRevenue,
    averageBookingValue: revenueBookingCount > 0 ? totalRevenue / revenueBookingCount : 0,
    totalAgencies: Number(agencyRows[0].total_agencies),
    // Profit margin is deliberately never computed — see this file's own
    // header comment / analytics.controller.js's own comment for why no
    // cost-basis field exists anywhere in this schema for FD bookings.
    profitMargin: {
      available: false,
      reason: 'FD packages have no reliable cost-basis field in the current schema — only the sell price (rate_per_pax) is stored, never an admin-entered net cost. Profit margin cannot be calculated without inventing a cost figure, so it is intentionally omitted rather than shown as a fabricated percentage.',
    },
    salesMix: salesMixRows.map((r) => ({
      createdVia: r.created_via,
      bookingCount: Number(r.booking_count),
      revenue: Number(r.revenue),
    })),
  };
}

module.exports.getSummary = getSummary;

async function getRevenueByMonth({ dateFrom, dateTo, agencyId, country }) {
  const agencyFilters = buildAgencyFilters({ agencyId, country });
  const values = [dateFrom, dateTo, ...agencyFilters.values];

  const { rows } = await pool.query(
    `SELECT
       DATE_FORMAT(b.created_at, '%Y-%m-01') AS month_start,
       COALESCE(SUM(CASE WHEN ${REVENUE_STATUS_EXCLUSION} THEN b.deposit_paid ELSE 0 END), 0) AS revenue,
       COUNT(*) AS booking_count
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     WHERE b.source_type = 'fd_package'
       AND b.created_at >= ?
       AND b.created_at < (? + INTERVAL 1 DAY)
       ${agencyFilters.clause}
     GROUP BY 1`,
    values
  );

  const byMonth = new Map();
  for (const r of rows) {
    const key = r.month_start instanceof Date ? r.month_start.toISOString().slice(0, 10) : String(r.month_start).slice(0, 10);
    byMonth.set(key, { revenue: Number(r.revenue), bookingCount: Number(r.booking_count) });
  }

  const months = [];
  const cursor = new Date(Date.UTC(
    new Date(dateFrom).getUTCFullYear(),
    new Date(dateFrom).getUTCMonth(),
    1
  ));
  const end = new Date(Date.UTC(
    new Date(dateTo).getUTCFullYear(),
    new Date(dateTo).getUTCMonth(),
    1
  ));
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const bucket = byMonth.get(key);
    months.push({
      month: key,
      revenue: bucket ? bucket.revenue : 0,
      bookingCount: bucket ? bucket.bookingCount : 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

module.exports.getRevenueByMonth = getRevenueByMonth;

async function getTopAgencies({ dateFrom, dateTo, agencyId, country, page, pageSize } = {}) {
  const dateFilters = buildDateFilters({ dateFrom, dateTo });
  const agencyFilters = buildAgencyFilters({ agencyId, country });
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
       a.country,
       COUNT(*) AS booking_count,
       COALESCE(SUM(CASE WHEN ${REVENUE_STATUS_EXCLUSION} THEN b.deposit_paid ELSE 0 END), 0) AS revenue
     FROM bookings b
     JOIN agencies a ON a.id = b.agency_id
     ${where}
     GROUP BY a.id, a.name, a.country
     ORDER BY revenue DESC, booking_count DESC
     LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  );

  return {
    rows: rows.map((r) => ({
      agencyId: r.agency_id,
      agencyName: r.agency_name,
      country: r.country,
      bookingCount: Number(r.booking_count),
      revenue: Number(r.revenue),
    })),
    total,
    page: currentPage,
    pageSize: limit,
  };
}

module.exports.getTopAgencies = getTopAgencies;
