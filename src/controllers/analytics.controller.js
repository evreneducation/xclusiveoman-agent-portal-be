import { getSummary, getRevenueByMonth, getTopAgencies } from '../models/analytics.model.js';

// Admin Analytics & Reporting (Task 19 — Screen 18, ANL-1). Mounted at
// /api/admin/analytics, requireRole('ops_admin', 'super_admin') per the
// doc's own §12.11 route annotation. Every number returned here comes from
// a real PostgreSQL aggregation in analytics.model.js — no client-side
// reconstruction, no mock data. See that file's own header comment for the
// exact revenue definition and why transactions.amount is never summed.

function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

// GET /api/admin/analytics/summary?dateFrom=&dateTo=&agencyId=&tier=&country=
export async function summary(req, res, next) {
  try {
    const { dateFrom, dateTo, agencyId, tier, country } = req.query;
    const data = await getSummary({ dateFrom, dateTo, agencyId, tier, country });
    res.json({ range: { dateFrom: dateFrom || null, dateTo: dateTo || null }, ...data });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/analytics/revenue-by-month?dateFrom=&dateTo=&agencyId=&tier=&country=
// Defaults to the last 12 calendar months (inclusive of the current one)
// when no range is given — a chart needs a concrete range to bucket, unlike
// summary/top-agencies which can meaningfully mean "all time" with no filter.
export async function revenueByMonth(req, res, next) {
  try {
    const { agencyId, tier, country } = req.query;
    let { dateFrom, dateTo } = req.query;

    if (!dateFrom || !dateTo) {
      const now = new Date();
      const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      dateFrom = dateFrom || toYmd(defaultFrom);
      dateTo = dateTo || toYmd(now);
    }

    const months = await getRevenueByMonth({ dateFrom, dateTo, agencyId, tier, country });
    res.json({ range: { dateFrom, dateTo }, months });
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/analytics/top-agencies?dateFrom=&dateTo=&agencyId=&tier=&country=&page=&pageSize=
export async function topAgencies(req, res, next) {
  try {
    const { dateFrom, dateTo, agencyId, tier, country, page, pageSize } = req.query;
    const { rows, total, page: currentPage, pageSize: limit } = await getTopAgencies({
      dateFrom,
      dateTo,
      agencyId,
      tier,
      country,
      page,
      pageSize,
    });

    res.json({
      range: { dateFrom: dateFrom || null, dateTo: dateTo || null },
      agencies: rows,
      pagination: { total, page: currentPage, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    next(err);
  }
}
