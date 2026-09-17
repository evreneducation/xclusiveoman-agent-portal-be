const {
  env
} = require('../config/env.js');

const {
  listFdPackages,
  findFdPackageById,
  listItineraryForPackage,
  composeItinerary,
  resolveRatePerPax,
  resolveFlightDetails,
  resolvePrimaryHotelId,
  loadCatalogPools,
  listDepartureDates,
  findDepartureDateById,
  listAddons
} = require('../models/fdPackages.model.js');

const {
  findAgencyById
} = require('../models/agencies.model.js');

const {
  siteTermsModel
} = require('../models/siteTerms.model.js');

const {
  buildWhatsAppLink
} = require('../utils/whatsapp.js');

const {
  getIo
} = require('../sockets/index.js');

const {
  createFdBooking
} = require('../services/booking.service.js');

const {
  generateFdItineraryPdf
} = require('../services/itineraryPdf.service.js');

// ratePerPax is fdPackage.rate_per_pax (an admin override) when set, else the
// sum of the package's day-by-day itinerary (see resolveRatePerPax) — the
// same price for every agency (agency tier was removed entirely — it no
// longer exists anywhere in this app, not just as a pricing input).
// `hotel` is the resolved primary hotel's own catalog row
// (resolvePrimaryHotelId + a pools.hotel lookup — see both call sites below),
// not fdPackage.hotel_city/hotel_name off the now-legacy hotel_id join,
// which stays null forever for a package whose hotel was placed on the
// itinerary instead (the only way FdPackageEditor.jsx sets a hotel today).
function toPublicPackage(fdPackage, ratePerPax, hotel) {
  return {
    id: fdPackage.id,
    title: fdPackage.title,
    theme: fdPackage.theme,
    duration: fdPackage.duration,
    heroImageUrl: fdPackage.hero_image_url,
    images: fdPackage.images || [],
    // fd_packages has no dedicated destination column — the resolved
    // primary hotel's city is the closest real-data stand-in.
    destination: hotel?.city || null,
    hotelName: hotel?.name || null,
    // Star rating shown on the listing card's "N Star Hotel" info row
    // (Departures.jsx's DepartureCard) — the resolved primary hotel's own
    // category, same resolution as hotelName/destination just above.
    hotelCategory: hotel?.category ?? null,
    shortDescription: fdPackage.short_description,
    suitableAgeMin: fdPackage.suitable_age_min,
    rating: fdPackage.rating,
    reviewCount: fdPackage.review_count,
    isFeatured: !!fdPackage.is_featured,
    isBestseller: !!fdPackage.is_bestseller,
    ratePerPax,
    // Client-facing Inclusions/Exclusions, admin-authored in FdPackageEditor.jsx
    // (see 0050_fd_packages_inclusions_exclusions.sql) — read-only here,
    // shown on the departure detail page (DepartureDetail.jsx).
    inclusions: fdPackage.inclusions || '',
    exclusions: fdPackage.exclusions || '',
  };
}

async function listDepartures(req, res, next) {
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
        const hotelId = resolvePrimaryHotelId(p, itinerary.items);
        const hotel = hotelId ? pools.hotel.find((h) => h.id === hotelId) : null;
        return {
          ...toPublicPackage(p, resolveRatePerPax(p, itinerary.items, pools), hotel),
          // Same null-unless-directly-included resolution the single-departure
          // GET already uses (resolveFlightDetails, see its own doc comment) —
          // added here too so the listing (Departures.jsx's DepartureCard) can
          // show an onward/return summary on the card itself when a package
          // has flights, without a second per-card request.
          flights: resolveFlightDetails(p, pools),
          nextDepartures: dates.map((d) => ({
            id: d.id,
            date: d.date,
            seatsLeft: d.seats_total - d.seats_booked,
            // Total capacity alongside seatsLeft — DepartureCard's seats-left
            // progress bar needs both ends of the ratio, not just what's
            // remaining.
            seatsTotal: d.seats_total,
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

module.exports.listDepartures = listDepartures;

// Builds the full agent-facing departure detail object — shared by the
// normal authenticated GET below and getDepartureDataForPdf (the Puppeteer-
// rendered print page's own data fetch), so the on-screen page and the
// downloaded PDF are always built from the exact same query/compose path
// rather than two independently-maintained copies drifting apart. Mirrors
// packageRequests.controller.js's toPublicPackageRequest, reused the same
// way by its own downloadItineraryPdf/getItineraryDataForPdf pair.
async function buildDepartureDetail(fdPackage) {
  const [itinerary, dates, addons, pools, siteTerms] = await Promise.all([
    listItineraryForPackage(fdPackage.id),
    listDepartureDates(fdPackage.id),
    listAddons(fdPackage.id),
    loadCatalogPools(),
    siteTermsModel.get(),
  ]);

  // pools.hotel already holds every hotel's full row (loadCatalogPools) —
  // resolving here off the itinerary's own hotel item instead of a second
  // hotelsModel.findById(fdPackage.hotel_id) call both fixes the
  // legacy-hotel_id bug (see resolvePrimaryHotelId) and avoids a redundant
  // DB round trip.
  const hotelId = resolvePrimaryHotelId(fdPackage, itinerary.items);
  const hotel = hotelId ? pools.hotel.find((h) => h.id === hotelId) : null;

  return {
    ...toPublicPackage(fdPackage, resolveRatePerPax(fdPackage, itinerary.items, pools), hotel),
    itinerary: composeItinerary(itinerary.days, itinerary.items, pools),
    // Meals (lunch/dinner) are opt-in fd_addons rows now (0075) — they come
    // back in `addons` below with type 'meal', not as a separate section.
    // null unless flights are included directly on the package — the
    // "Flight Details" collapsible section (DepartureDetail.jsx) only
    // renders when this comes back non-null.
    flights: resolveFlightDetails(fdPackage, pools),
    departureDates: dates.map((d) => ({
      id: d.id,
      date: d.date,
      seatsLeft: d.seats_total - d.seats_booked,
      seatsTotal: d.seats_total,
      location: d.location,
    })),
    // `type` tells the agent-facing UI (DepartureDetail.jsx) which category
    // heading an add-on belongs under (Activities/Tours/Transfers/Flights/
    // Meals) — derived from whichever of the 5 mutually exclusive *_id
    // columns is set (fd_addons_exactly_one_item CHECK guarantees exactly
    // one). `name` falls back through all 5 joined name columns (listAddons);
    // a meal add-on has no per-row name, so it's labelled by meal type.
    addons: addons.map((a) => ({
      id: a.id,
      type: a.activity_id
        ? 'activity'
        : a.tour_id
          ? 'tour'
          : a.transfer_id
            ? 'transfer'
            : a.flight_id
              ? 'flight'
              : 'meal',
      // The catalog row's own id (not `id` above, which is the fd_addons
      // join-row id) — lets the agent-facing "View Details" combobox
      // (DepartureDetail.jsx) fetch the full catalog record straight off
      // the existing generic GET /:entity/:id detail route
      // (catalog.routes.js) using this + `type`.
      catalogId: a.activity_id || a.tour_id || a.transfer_id || a.flight_id || a.meal_id,
      name:
        a.activity_name ||
        a.tour_name ||
        a.transfer_name ||
        a.flight_name ||
        (a.meal_type ? a.meal_type[0].toUpperCase() + a.meal_type.slice(1) : a.meal_name),
      pricePerPax: Number(a.price_per_pax),
    })),
    // Site-wide "Booking terms" (0067_site_terms.sql), admin-authored in the
    // Terms & Conditions tab — the on-screen DepartureDetail.jsx fetches this
    // itself from the authed GET /site-terms, but the Puppeteer print page
    // (DepartureItineraryPrint.jsx) has only a pdfToken, not a login session,
    // so it can't call that route — carry the HTML through here so the
    // downloaded PDF can append the same terms section the web page shows.
    terms: siteTerms?.body_html || null,
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
  };
}

async function getDeparture(req, res, next) {
  try {
    const fdPackage = await findFdPackageById(req.params.id);
    if (!fdPackage || fdPackage.status !== 'published') {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json({ departure: await buildDepartureDetail(fdPackage) });
  } catch (err) {
    next(err);
  }
}

module.exports.getDeparture = getDeparture;

async function getDepartureDataForPdf(req, res, next) {
  try {
    const { id } = req.params;
    if (req.fdPdfClaims.departureId !== id) {
      return res.status(403).json({ error: 'forbidden', message: 'This token is not valid for this itinerary' });
    }

    const fdPackage = await findFdPackageById(id);
    if (!fdPackage || fdPackage.status !== 'published') {
      return res.status(404).json({ error: 'not_found' });
    }

    res.json({ departure: await buildDepartureDetail(fdPackage) });
  } catch (err) {
    next(err);
  }
}

module.exports.getDepartureDataForPdf = getDepartureDataForPdf;

async function downloadDepartureItineraryPdf(req, res, next) {
  try {
    const { id } = req.params;
    const fdPackage = await findFdPackageById(id);
    if (!fdPackage || fdPackage.status !== 'published') {
      return res.status(404).json({ error: 'not_found' });
    }

    let pdfBuffer;
    try {
      pdfBuffer = await generateFdItineraryPdf({ departureId: id, userId: req.user.id });
    } catch (err) {
      // Logged here, not left to errorHandler.js's own console.error — the
      // res.status(...).json(...) below returns directly instead of calling
      // next(err), so errorHandler.js's handler (and its logging) never runs
      // for this path. Without this, the real Puppeteer failure (navigation
      // timeout, CORS/network error surfaced via window.__PDF_ERROR__, etc.)
      // was completely invisible in production — only the generic public
      // message ever reached anywhere-visible.
      console.error(`[itinerary.pdf] FD departure ${id} generation failed:`, err);
      // Distinguish "we couldn't render it" from a generic 500 — the agent
      // sees a clear "try again" message instead of a bare server error.
      err.status = 502;
      err.publicMessage = 'Unable to generate the itinerary PDF right now. Please try again.';
      throw err;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="itinerary-${id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    if (err.status && err.publicMessage) {
      return res.status(err.status).json({ error: 'pdf_generation_failed', message: err.publicMessage });
    }
    next(err);
  }
}

module.exports.downloadDepartureItineraryPdf = downloadDepartureItineraryPdf;

async function createBooking(req, res, next) {
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
    const { pax, addonIds = [], addonDayNumbers = {}, travelers = [] } = req.body;

    const { booking } = await createFdBooking({
      fdPackage,
      departureDate,
      agencyId: agency.id,
      createdByUserId: req.user.id,
      createdVia: 'self_service',
      pax,
      addonIds,
      addonDayNumbers,
      travelers,
    });

    getIo()?.to(`agency:${agency.id}`).emit('booking:status_changed', {
      bookingId: booking.id,
      status: booking.status,
    });

    const depositDue = Number(booking.deposit_due);
    const amountDueNow = Math.max(0, depositDue - Number(booking.deposit_paid));
    res.status(201).json({
      booking: {
        id: booking.id,
        status: booking.status,
        pax: booking.pax,
        totalPrice: Number(booking.total_price),
        balanceDue: Number(booking.balance_due),
        balanceDueDate: booking.balance_due_date,
        // Part-payment (0077): what must be paid now to hold the seat (full
        // price inside 15 days of departure, otherwise the flat deposit),
        // and the still-outstanding remainder collected later.
        depositDue,
        amountDueNow,
        remainingBalance: Math.max(0, Number(booking.balance_due) - amountDueNow),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports.createBooking = createBooking;

async function enquireNow(req, res, next) {
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

module.exports.enquireNow = enquireNow;
