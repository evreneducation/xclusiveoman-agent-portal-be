import { pool } from '../db/pool.js';
import { env } from '../config/env.js';
import {
  listFdPackages,
  findFdPackageById,
  listItineraryForPackage,
  composeItinerary,
  resolveRatePerPax,
  loadCatalogPools,
  listDepartureDates,
  findDepartureDateById,
  listAddons,
  findAddonsByIds,
  incrementSeatsBooked,
} from '../models/fdPackages.model.js';
import { findAgencyById } from '../models/agencies.model.js';
import { hotelsModel } from '../models/catalog.model.js';
import { buildWhatsAppLink } from '../utils/whatsapp.js';
import { getIo } from '../sockets/index.js';

// FD packages no longer carry a per-package deposit/balance-due policy (that
// was admin-editable, informational-only for deposit and only actually wired
// into balance_due_date for the "days before"); every booking now uses this
// fixed lead time instead. depositPaid stays 0 at booking time regardless —
// deposit collection happens through the payment flow, not here.
const DEFAULT_BALANCE_DUE_DAYS_BEFORE = 30;

// ratePerPax is fdPackage.rate_per_pax (an admin override) when set, else the
// sum of the package's day-by-day itinerary (see resolveRatePerPax) — the
// same price for every agency, regardless of tier. Agency tier still exists
// for other purposes (approvals, marketing), it just no longer drives FD
// package pricing.
function toPublicPackage(fdPackage, ratePerPax) {
  return {
    id: fdPackage.id,
    title: fdPackage.title,
    theme: fdPackage.theme,
    duration: fdPackage.duration,
    heroImageUrl: fdPackage.hero_image_url,
    images: fdPackage.images || [],
    // fd_packages has no dedicated destination column — the linked hotel's
    // city is the closest real-data stand-in (see listFdPackages' join).
    destination: fdPackage.hotel_city || null,
    hotelName: fdPackage.hotel_name || null,
    shortDescription: fdPackage.short_description,
    suitableAgeMin: fdPackage.suitable_age_min,
    rating: fdPackage.rating,
    reviewCount: fdPackage.review_count,
    isFeatured: fdPackage.is_featured,
    isBestseller: fdPackage.is_bestseller,
    ratePerPax,
  };
}

// GET /api/departures?destination=&date_from=&theme=&featured=&bestseller=
export async function listDepartures(req, res, next) {
  try {
    const [packages, pools] = await Promise.all([
      listFdPackages({
        destination: req.query.destination,
        theme: req.query.theme,
        featured: req.query.featured,
        bestseller: req.query.bestseller,
      }),
      loadCatalogPools(),
    ]);

    const withDates = await Promise.all(
      packages.map(async (p) => {
        const [dates, itinerary] = await Promise.all([listDepartureDates(p.id), listItineraryForPackage(p.id)]);
        return {
          ...toPublicPackage(p, resolveRatePerPax(p, itinerary.items, pools)),
          nextDepartures: dates.map((d) => ({
            id: d.id,
            date: d.date,
            seatsLeft: d.seats_total - d.seats_booked,
            location: d.location,
          })),
        };
      })
    );

    res.json({ departures: withDates });
  } catch (err) {
    next(err);
  }
}

// GET /api/departures/:id — resolves net rate (from the itinerary) + itinerary/add-ons for the caller.
export async function getDeparture(req, res, next) {
  try {
    const fdPackage = await findFdPackageById(req.params.id);
    if (!fdPackage || fdPackage.status !== 'published') {
      return res.status(404).json({ error: 'not_found' });
    }

    const [itinerary, dates, addons, hotel, pools] = await Promise.all([
      listItineraryForPackage(fdPackage.id),
      listDepartureDates(fdPackage.id),
      listAddons(fdPackage.id),
      fdPackage.hotel_id ? hotelsModel.findById(fdPackage.hotel_id) : null,
      loadCatalogPools(),
    ]);

    res.json({
      departure: {
        ...toPublicPackage(fdPackage, resolveRatePerPax(fdPackage, itinerary.items, pools)),
        itinerary: composeItinerary(itinerary.days, itinerary.items, pools),
        departureDates: dates.map((d) => ({
          id: d.id,
          date: d.date,
          seatsLeft: d.seats_total - d.seats_booked,
          location: d.location,
        })),
        addons: addons.map((a) => ({
          id: a.id,
          name: a.activity_name || a.tour_name,
          pricePerPax: Number(a.price_per_pax),
        })),
        // Richer hotel detail for the "Hotel Information" section — the
        // listing/toPublicPackage only carries hotelName for the card.
        hotel: hotel
          ? {
              id: hotel.id,
              name: hotel.name,
              city: hotel.city,
              state: hotel.state,
              category: hotel.category,
              boardBasisOptions: hotel.board_basis_options || [],
              description: hotel.description,
              images: hotel.images || [],
            }
          : null,
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
    const { pax, addonIds = [], travelers = [] } = req.body;

    const [addons, itinerary, pools] = await Promise.all([
      findAddonsByIds(fdPackage.id, addonIds),
      listItineraryForPackage(fdPackage.id),
      loadCatalogPools(),
    ]);
    const ratePerPax = resolveRatePerPax(fdPackage, itinerary.items, pools);
    const addonsPerPax = addons.reduce((sum, a) => sum + Number(a.price_per_pax), 0);
    const totalPrice = (ratePerPax + addonsPerPax) * pax;
    const depositPaid = 0;
    const balanceDue = totalPrice - depositPaid;
    const balanceDueDate = new Date(
      new Date(departureDate.date).getTime() - DEFAULT_BALANCE_DUE_DAYS_BEFORE * 24 * 60 * 60 * 1000
    );

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
