import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import {
  listFdPackages,
  findFdPackageById,
  listItineraryDays,
  listDepartureDates,
  findDepartureDateById,
  listAddons,
  findAddonsByIds,
  incrementSeatsBooked,
} from '../models/fdPackages.model.js';
import { findAgencyById } from '../models/agencies.model.js';
import { buildWhatsAppLink } from '../utils/whatsapp.js';
import { getIo } from '../sockets/index.js';

const TIER_RATE_COLUMN = { gold: 'rate_gold', silver: 'rate_silver', bronze: 'rate_bronze' };

function tieredRate(fdPackage, tier) {
  const column = TIER_RATE_COLUMN[tier] || 'rate_bronze';
  return Number(fdPackage[column] ?? fdPackage.rate_bronze ?? 0);
}

function toPublicPackage(fdPackage, tier) {
  return {
    id: fdPackage.id,
    title: fdPackage.title,
    theme: fdPackage.theme,
    duration: fdPackage.duration,
    heroImageUrl: fdPackage.hero_image_url,
    shortDescription: fdPackage.short_description,
    suitableAgeMin: fdPackage.suitable_age_min,
    rating: fdPackage.rating,
    reviewCount: fdPackage.review_count,
    isFeatured: fdPackage.is_featured,
    isBestseller: fdPackage.is_bestseller,
    ratePerPax: tieredRate(fdPackage, tier),
    depositAmount: fdPackage.deposit_amount,
    balanceDueDaysBefore: fdPackage.balance_due_days_before,
  };
}

// GET /api/departures?destination=&date_from=&theme=&featured=&bestseller=
export async function listDepartures(req, res, next) {
  try {
    const agency = req.user.agency_id ? await findAgencyById(req.user.agency_id) : null;
    const tier = agency?.tier || 'bronze';

    const packages = await listFdPackages({
      destination: req.query.destination,
      theme: req.query.theme,
      featured: req.query.featured,
      bestseller: req.query.bestseller,
    });

    const withDates = await Promise.all(
      packages.map(async (p) => {
        const dates = await listDepartureDates(p.id);
        return {
          ...toPublicPackage(p, tier),
          nextDepartures: dates.map((d) => ({
            id: d.id,
            date: d.date,
            seatsLeft: d.seats_total - d.seats_booked,
          })),
        };
      })
    );

    res.json({ departures: withDates });
  } catch (err) {
    next(err);
  }
}

// GET /api/departures/:id — resolves tiered rate + itinerary/add-ons for the caller.
export async function getDeparture(req, res, next) {
  try {
    const fdPackage = await findFdPackageById(req.params.id);
    if (!fdPackage || fdPackage.status !== 'published') {
      return res.status(404).json({ error: 'not_found' });
    }

    const agency = req.user.agency_id ? await findAgencyById(req.user.agency_id) : null;
    const tier = agency?.tier || 'bronze';

    const [itinerary, dates, addons] = await Promise.all([
      listItineraryDays(fdPackage.id),
      listDepartureDates(fdPackage.id),
      listAddons(fdPackage.id),
    ]);

    res.json({
      departure: {
        ...toPublicPackage(fdPackage, tier),
        itinerary: itinerary.map((d) => ({ dayNumber: d.day_number, description: d.description })),
        departureDates: dates.map((d) => ({
          id: d.id,
          date: d.date,
          seatsLeft: d.seats_total - d.seats_booked,
        })),
        addons: addons.map((a) => ({
          id: a.id,
          name: a.activity_name || a.tour_name,
          pricePerPax: Number(a.price_per_pax),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/departures/:id/bookings — FGD-5, FGD-6, FGD-9; re-validates price server-side (rule 67).
export async function createBooking(req, res, next) {
  const client = await pool.connect();
  try {
    const fdPackage = await findFdPackageById(req.params.id);
    if (!fdPackage || fdPackage.status !== 'published') {
      return res.status(404).json({ error: 'not_found' });
    }

    const departureDate = await findDepartureDateById(req.body.departureDateId);
    if (!departureDate || departureDate.fd_package_id !== fdPackage.id) {
      return res.status(400).json({ error: 'invalid_departure_date' });
    }

    const agency = await findAgencyById(req.user.agency_id);
    const tier = agency?.tier || 'bronze';
    const { pax, addonIds = [], travelers = [] } = req.body;

    const addons = await findAddonsByIds(fdPackage.id, addonIds);
    const ratePerPax = tieredRate(fdPackage, tier);
    const addonsPerPax = addons.reduce((sum, a) => sum + Number(a.price_per_pax), 0);
    const totalPrice = (ratePerPax + addonsPerPax) * pax;
    const depositPaid = 0;
    const balanceDue = totalPrice - depositPaid;
    const balanceDueDate = fdPackage.balance_due_days_before
      ? new Date(
          new Date(departureDate.date).getTime() -
            fdPackage.balance_due_days_before * 24 * 60 * 60 * 1000
        )
      : null;

    await client.query('BEGIN');

    const seatsResult = await incrementSeatsBooked(client, departureDate.id, pax);
    const status = seatsResult ? 'pending_payment' : 'waitlisted';

    const { rows: bookingRows } = await client.query(
      `INSERT INTO bookings
        (source_type, source_id, fd_departure_date_id, agency_id, created_by_user_id,
         pax, total_price, deposit_paid, balance_due, balance_due_date, status, created_via)
       VALUES ('fd_package', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'self_service')
       RETURNING *`,
      [
        fdPackage.id, departureDate.id, agency.id, req.user.id,
        pax, totalPrice, depositPaid, balanceDue, balanceDueDate, status,
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

    getIo()?.to(`agency:${agency.id}`).emit('booking:status_changed', {
      bookingId: booking.id,
      status: booking.status,
    });

    res.status(201).json({
      booking: {
        id: booking.id,
        status: booking.status,
        pax: booking.pax,
        totalPrice: Number(booking.total_price),
        balanceDue: Number(booking.balance_due),
        balanceDueDate: booking.balance_due_date,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/departures/:id/enquire — FGD-7: pre-filled WhatsApp deep link, no form/booking created.
export async function enquireNow(req, res, next) {
  try {
    const fdPackage = await findFdPackageById(req.params.id);
    if (!fdPackage) return res.status(404).json({ error: 'not_found' });

    const { date, pax } = req.query;
    const message = `Hi, I'd like to enquire about ${fdPackage.title}${date ? `, ${date}` : ''}${
      pax ? `, ${pax} pax` : ''
    }`;

    res.json({ whatsappLink: buildWhatsAppLink(env.whatsappSalesNumber, message) });
  } catch (err) {
    next(err);
  }
}
