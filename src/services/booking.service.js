import { pool } from '../db/pool.js';
import {
  listItineraryForPackage,
  resolveRatePerPax,
  loadCatalogPools,
  findAddonsByIds,
  incrementSeatsBooked,
} from '../models/fdPackages.model.js';
import { listTravelersForRequest } from '../models/packageRequests.model.js';
import { findBookingBySource } from '../models/bookings.model.js';

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

// Part-payment policy for FD departures (0077_booking_deposit_due.sql):
// inside this many days of departure the whole booking value is due up
// front; earlier than that, only a flat deposit is due now and the rest is
// collected later.
const FD_FULL_PAYMENT_LEAD_DAYS = 15;
const FD_DEPOSIT_AMOUNT = 5000;

// The "pay this now to hold the seat" figure, fixed at booking time.
// `departureDateISO` is the fd_departure_dates.date value.
function computeFdDepositDue(departureDateISO, totalPrice) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilDeparture = Math.ceil((new Date(departureDateISO).getTime() - Date.now()) / msPerDay);
  if (daysUntilDeparture < FD_FULL_PAYMENT_LEAD_DAYS) return totalPrice;
  // Never ask for more deposit than the booking is even worth.
  return Math.min(FD_DEPOSIT_AMOUNT, totalPrice);
}

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
 * @param {Object<string, number[]>} [addonDayNumbers] - fd_addons id -> itinerary day numbers,
 *   for meal-type addons limited to specific days (0080_booking_addon_days.sql).
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
  addonDayNumbers = {},
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

    // Lunch/Dinner add-ons can be limited to specific itinerary days
    // (0080_booking_addon_days.sql) instead of always covering the whole
    // package — never trust the client's day numbers: re-validated here
    // against this package's real fd_itinerary_days, and priced per selected
    // day (meal.price_per_day × count) instead of the fd_addons row's
    // full-duration snapshot. Any addon with no day numbers submitted (every
    // non-meal type, or a meal added with none picked) keeps the existing
    // whole-package snapshot behavior unchanged.
    const validDayNumbers = new Set(itinerary.days.map((d) => d.day_number));
    function priceAndDaysFor(addon) {
      const days = addon.meal_id ? addonDayNumbers[addon.id] || [] : [];
      if (days.length === 0) return { pricePerPax: Number(addon.price_per_pax), days: [] };
      if (!days.every((d) => validDayNumbers.has(d))) {
        throw Object.assign(new Error('Selected day is not part of this package\'s itinerary'), { status: 400 });
      }
      const meal = pools.meal.find((m) => m.id === addon.meal_id);
      return { pricePerPax: Number(meal?.price_per_day || 0) * days.length, days };
    }
    const addonPricing = new Map(addons.map((a) => [a.id, priceAndDaysFor(a)]));

    // ratePerPax (resolveRatePerPax) folds in any included visa (Task 5 — a
    // checkbox inclusion priced off the visa catalog, a real per-pax figure
    // with nothing left to resolve here). Meals are opt-in fd_addons rows
    // now (0075), so they ride the addonsPerPax sum below like every other
    // add-on. This only ever multiplies by the one thing that can't be known
    // before now: real pax.
    const ratePerPax = resolveRatePerPax(fdPackage, itinerary.items, pools);
    const addonsPerPax = addons.reduce((sum, a) => sum + addonPricing.get(a.id).pricePerPax, 0);
    const computedTotalPrice = (ratePerPax + addonsPerPax) * pax;
    const totalPrice = agreedTotalPrice != null ? agreedTotalPrice : computedTotalPrice;

    const balanceDue = Math.max(0, totalPrice - depositPaid);
    const balanceDueDate = new Date(
      new Date(departureDate.date).getTime() - DEFAULT_BALANCE_DUE_DAYS_BEFORE * 24 * 60 * 60 * 1000
    );
    // How much of `totalPrice` must be paid now for this booking to be
    // held: the full amount within 15 days of departure, otherwise a flat
    // deposit. An admin manual booking may already carry an offline
    // depositPaid — this stays the gross policy figure regardless; "still
    // due now" is deposit_due - deposit_paid, computed where it's shown.
    const depositDue = computeFdDepositDue(departureDate.date, totalPrice);

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
         pax, total_price, deposit_paid, balance_due, balance_due_date, deposit_due, status, created_via)
       VALUES ('fd_package', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        fdPackage.id, departureDate.id, agencyId, createdByUserId,
        pax, totalPrice, depositPaid, balanceDue, balanceDueDate, depositDue, status, createdVia,
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
      const { pricePerPax, days } = addonPricing.get(addon.id);
      await client.query(
        `INSERT INTO booking_addons (booking_id, fd_addon_id, price_per_pax, day_numbers) VALUES ($1, $2, $3, $4)`,
        [booking.id, addon.id, pricePerPax, days]
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

// FIT quote -> booking conversion (FIT-13: "an accepted+paid quote converts
// to a booking" — package_requests.status already has a 'converted' value,
// and booking_source_type already includes 'package_request', but nothing
// ever actually inserted one; agent's respond() previously just flipped the
// quote to 'accepted' and stopped there). Called from
// packageRequests.controller.js#respond right after that status transition
// commits.
//
// FIT quotes have no per-package deposit/balance-due policy defined either
// (same gap FD packages had before DEFAULT_BALANCE_DUE_DAYS_BEFORE above) —
// reuses that same 30-day-before-trip default off the quote's own
// date_from, rather than inventing a second, undocumented policy.
export async function createBookingFromPackageRequest(packageRequest) {
  // Idempotent by construction, not just by the caller's own guard: a
  // package_request can only ever transition published -> accepted once
  // (respondToPackageRequest's own WHERE status='published' clause makes a
  // second respond() call fail with 'not_published' before this is ever
  // reached again), but this checks for real regardless — "already created?
  // don't create it again" — rather than trusting that invariant alone.
  const existing = await findBookingBySource('package_request', packageRequest.id);
  if (existing) {
    return { booking: existing, created: false };
  }

  const client = await pool.connect();
  try {
    const travelers = await listTravelersForRequest(packageRequest.id);
    const pax = Math.max(1, (packageRequest.pax_adults || 0) + (packageRequest.pax_children || 0));
    const totalPrice = Number(packageRequest.sell_price) || 0;
    const depositPaid = 0; // no deposit captured at accept time — same as FD self-service's own default
    const balanceDue = Math.max(0, totalPrice - depositPaid);
    const balanceDueDate = new Date(
      new Date(packageRequest.date_from).getTime() - DEFAULT_BALANCE_DUE_DAYS_BEFORE * 24 * 60 * 60 * 1000
    );
    const status = deriveStatusFromDeposit(depositPaid, totalPrice);

    await client.query('BEGIN');

    // FIT quotes keep the "full amount due now" behaviour — the 15-day
    // part-payment policy (computeFdDepositDue) is an FD-departure rule
    // only, so deposit_due mirrors total_price here.
    const { rows: bookingRows } = await client.query(
      `INSERT INTO bookings
        (source_type, source_id, agency_id, created_by_user_id,
         pax, total_price, deposit_paid, balance_due, balance_due_date, deposit_due, status, created_via)
       VALUES ('package_request', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'self_service')
       RETURNING *`,
      [
        packageRequest.id, packageRequest.agency_id, packageRequest.created_by_user_id,
        pax, totalPrice, depositPaid, balanceDue, balanceDueDate, totalPrice, status,
      ]
    );
    const booking = bookingRows[0];

    for (const traveler of travelers) {
      await client.query(
        `INSERT INTO booking_travelers (booking_id, name, passport_no, dob, room_share_group)
         VALUES ($1, $2, $3, $4, $5)`,
        [booking.id, traveler.name, traveler.passport_no || null, traveler.dob || null, traveler.room_share_group || null]
      );
    }

    await client.query('COMMIT');
    return { booking, created: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
