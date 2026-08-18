import { pool } from '../db/pool.js';
import {
  listItineraryForPackage,
  resolveRatePerPax,
  loadCatalogPools,
  findAddonsByIds,
  incrementSeatsBooked,
} from '../models/fdPackages.model.js';

// FD booking creation — the one real "create a bookings row" transaction in
// this codebase (Task 13). Extracted out of departures.controller.js#createBooking
// (self-service) so the new Admin Manual Booking flow
// (bookingsAdmin.controller.js) can create the exact same kind of row
// through the exact same atomic path, instead of a second, parallel booking
// engine — per Task 13's own "do not duplicate booking business logic" rule.
// Self-service behavior is unchanged: it calls this with no agreedTotalPrice/
// depositPaid override, which reproduces its old inline logic exactly.

// FD packages carry no per-package deposit/balance-due policy — every
// booking uses this fixed lead time (moved here verbatim from
// departures.controller.js, its only previous home).
const DEFAULT_BALANCE_DUE_DAYS_BEFORE = 30;

// depositPaid=0 → pending_payment (self-service's own default, and an admin
// manual booking recorded with no offline deposit yet); a partial deposit →
// confirmed; a deposit covering the full price → fully_paid. Mirrors
// paymentConfirmation.service.js#confirmPayment's own
// "balanceDue <= 0 ? fully_paid : confirmed" derivation, generalized to also
// cover the zero-deposit case confirmPayment never has to (it's only ever
// called with a real payment > 0).
function deriveStatusFromDeposit(depositPaid, totalPrice) {
  if (depositPaid <= 0) return 'pending_payment';
  return depositPaid >= totalPrice ? 'fully_paid' : 'confirmed';
}

/**
 * Creates one FD booking, atomically, exactly like the pre-Task-13
 * self-service flow did inline: resolve server-side pricing (unless an
 * agreed override is given), atomically decrement seats (or waitlist if
 * sold out — see incrementSeatsBooked's own race-safe WHERE clause), insert
 * the booking, its travelers, and its addons, all in one transaction.
 *
 * @param {object} fdPackage - already-fetched, already status-validated by the caller.
 * @param {object} departureDate - already-fetched, already verified to belong to fdPackage by the caller.
 * @param {string} agencyId - already-validated by the caller (self-service: req.user.agency_id; admin: an approved agency).
 * @param {string} createdByUserId
 * @param {'self_service'|'manual_admin'} createdVia
 * @param {number} pax
 * @param {string[]} [addonIds]
 * @param {Array<{name:string, passportNo?:string, dob?:string, roomShareGroup?:string}>} [travelers]
 * @param {number} [agreedTotalPrice] - Admin Manual Booking's MAN-3 override (agreed sell price).
 *   Deliberately bypasses server-computed pricing when present — the whole
 *   point of a manual booking is that admin already negotiated the real
 *   price by phone; recomputing it from the catalog would silently
 *   overwrite that. Still validated (positive finite number) by the
 *   caller's zod schema before it ever reaches here — "never trust a
 *   client price" for self-service means "always compute it server-side";
 *   for admin it means "never accept a malformed one", which is a
 *   different, narrower guarantee this function still upholds by simply
 *   never accepting anything except a plain positive number.
 * @param {number} [depositPaid] - Offline deposit an admin captured; self-service always omits this (stays 0).
 */
export async function createFdBooking({
  fdPackage,
  departureDate,
  agencyId,
  createdByUserId,
  createdVia,
  pax,
  addonIds = [],
  travelers = [],
  agreedTotalPrice,
  depositPaid = 0,
}) {
  const client = await pool.connect();
  try {
    const [addons, itinerary, pools] = await Promise.all([
      findAddonsByIds(fdPackage.id, addonIds),
      listItineraryForPackage(fdPackage.id),
      loadCatalogPools(),
    ]);

    const ratePerPax = resolveRatePerPax(fdPackage, itinerary.items, pools);
    const addonsPerPax = addons.reduce((sum, a) => sum + Number(a.price_per_pax), 0);
    const computedTotalPrice = (ratePerPax + addonsPerPax) * pax;
    const totalPrice = agreedTotalPrice != null ? agreedTotalPrice : computedTotalPrice;

    const balanceDue = Math.max(0, totalPrice - depositPaid);
    const balanceDueDate = new Date(
      new Date(departureDate.date).getTime() - DEFAULT_BALANCE_DUE_DAYS_BEFORE * 24 * 60 * 60 * 1000
    );

    await client.query('BEGIN');

    // Single atomic UPDATE ... WHERE seats_total - seats_booked >= pax —
    // the only seat check anywhere in this codebase, race-safe by
    // construction (no separate read-then-write window). A null result
    // means sold out; the booking still gets created, just waitlisted
    // (FGD-11) — reused as-is, not reinterpreted, per Task 13's explicit
    // "do not introduce a second seat-allocation mechanism" instruction.
    const seatsResult = await incrementSeatsBooked(client, departureDate.id, pax);
    const waitlisted = !seatsResult;
    // Sold-out/waitlisted always wins over deposit-derived status — an
    // admin who captured an offline deposit for a departure that turned
    // out to be full still gets a waitlisted booking, not a confirmed one
    // for a seat that doesn't exist.
    const status = waitlisted ? 'waitlisted' : deriveStatusFromDeposit(depositPaid, totalPrice);

    const { rows: bookingRows } = await client.query(
      `INSERT INTO bookings
        (source_type, source_id, fd_departure_date_id, agency_id, created_by_user_id,
         pax, total_price, deposit_paid, balance_due, balance_due_date, status, created_via)
       VALUES ('fd_package', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        fdPackage.id, departureDate.id, agencyId, createdByUserId,
        pax, totalPrice, depositPaid, balanceDue, balanceDueDate, status, createdVia,
      ]
    );
    const booking = bookingRows[0];

    for (const traveler of travelers) {
      await client.query(
        `INSERT INTO booking_travelers (booking_id, name, passport_no, dob, room_share_group)
         VALUES ($1, $2, $3, $4, $5)`,
        [booking.id, traveler.name, traveler.passportNo || null, traveler.dob || null, traveler.roomShareGroup || null]
      );
    }

    for (const addon of addons) {
      await client.query(
        `INSERT INTO booking_addons (booking_id, fd_addon_id, price_per_pax) VALUES ($1, $2, $3)`,
        [booking.id, addon.id, addon.price_per_pax]
      );
    }

    await client.query('COMMIT');

    return { booking, waitlisted };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
