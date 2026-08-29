import { findBookingById, listAgencyBookings, listBookingTravelers } from '../models/bookings.model.js';

function toPublicBooking(b) {
  const depositDue = Number(b.deposit_due);
  // What's still due right now to hold the seat: the part-payment figure
  // fixed at booking time (0077 — full price within 15 days of departure,
  // otherwise a flat deposit) minus whatever's already been paid. Drops to
  // zero once that first payment lands; the payment screen charges this,
  // not the whole balance.
  const amountDueNow = Math.max(0, depositDue - Number(b.deposit_paid));
  return {
    id: b.id,
    sourceType: b.source_type,
    sourceId: b.source_id,
    pax: b.pax,
    totalPrice: Number(b.total_price),
    depositPaid: Number(b.deposit_paid),
    balanceDue: Number(b.balance_due),
    balanceDueDate: b.balance_due_date,
    depositDue,
    amountDueNow,
    remainingBalance: Math.max(0, Number(b.balance_due) - amountDueNow),
    status: b.status,
    createdAt: b.created_at,
  };
}

// GET /api/bookings/:id
export async function getBooking(req, res, next) {
  try {
    const booking = await findBookingById(req.params.id);
    if (!booking || booking.agency_id !== req.user.agency_id) {
      return res.status(404).json({ error: 'not_found' });
    }
    const travelers = await listBookingTravelers(booking.id);
    res.json({
      booking: {
        ...toPublicBooking(booking),
        travelers: travelers.map((t) => ({ name: t.name, passportNo: t.passport_no })),
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings — "My Bookings"
export async function listMyBookings(req, res, next) {
  try {
    const rows = await listAgencyBookings(req.user.agency_id);
    res.json({ bookings: rows.map(toPublicBooking) });
  } catch (err) {
    next(err);
  }
}
