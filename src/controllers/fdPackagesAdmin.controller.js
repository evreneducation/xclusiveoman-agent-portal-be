import {
  listAllFdPackagesForAdmin,
  findFdPackageById,
  createFdPackage,
  updateFdPackage,
  deleteFdPackage,
  listItineraryForPackage,
  replaceItinerary,
  composeItinerary,
  resolveRatePerPax,
  loadCatalogPools,
  listDepartureDates,
  addDepartureDate,
  removeDepartureDate,
  listAddons,
  addAddon,
  removeAddon,
} from '../models/fdPackages.model.js';
import { activitiesModel, toursModel, transfersModel, flightsModel, mealsModel } from '../models/catalog.model.js';
import { parseDurationDays } from '../utils/meals.js';
import { toSnakeCaseColumns } from '../validation/schemas.js';
import { uploadBuffer } from '../services/cloudinary.service.js';

// Postgres NUMERIC columns come back from `pg` as strings (to avoid silent
// float precision loss), not JS numbers. Left unconverted, those strings flow
// straight into the admin form on GET and then get POSTed/PATCHed back
// unchanged, tripping the `z.number()` checks in fdPackageSchema with
// "Expected number, received string". Convert here so every response the
// admin UI reads back already has real numbers (null stays null instead of
// becoming 0, since these columns have no DB default).
function toNumOrNull(v) {
  return v === null || v === undefined ? null : Number(v);
}

// Mirrors the admin UI's own pre-Publish gate (FdPackageEditor.jsx's
// findCarouselImagesError) — enforced here too so a package can never be
// published with a thin gallery via a direct API call that skips the UI.
// Only blocks the transition *into* (or staying) 'published'; a package
// still being drafted/autosaved can hold any number of images, same as the
// day-by-day itinerary, which has no equivalent server-side check either.
const MIN_CAROUSEL_IMAGES = 4;

function carouselImagesError(images, status) {
  if (status === 'published' && (images || []).length < MIN_CAROUSEL_IMAGES) {
    return `Add at least ${MIN_CAROUSEL_IMAGES} carousel images before publishing.`;
  }
  return null;
}

// Same "only checked at the moment of publishing" gate as carouselImagesError
// above — a package can sit in draft with no hero image while the admin is
// still building it out (heroImageUrl is nullable in fdPackageSchema for
// exactly that reason), but needs one before it goes live.
function heroImageError(heroImageUrl, status) {
  if (status === 'published' && !heroImageUrl) {
    return 'Add a hero image before publishing.';
  }
  return null;
}

// Same "only checked at the moment of publishing" gate as carouselImagesError
// above, for the Flights section (0064_fd_package_flights.sql) — flying
// solely on flightsEnabled being true (mid-edit, before either flight is
// picked yet) would reject the debounced autosave PATCH that fires the
// instant the toggle is flipped on, well before the admin has had a chance
// to actually pick a flight.
function flightsSelectionError(flightsEnabled, onwardFlightId, returnFlightId, status) {
  if (status === 'published' && flightsEnabled && (!onwardFlightId || !returnFlightId)) {
    return 'Select both an Onward and a Return flight before publishing, or turn off the Flights section.';
  }
  return null;
}

// fd_packages.hotel_id/hotel_name are a pre-day-by-day-itinerary leftover
// (0013_fd_package_hotel.sql) — the day-by-day itinerary builder
// (ItineraryManager, FdPackageEditor.jsx) never writes to that column, it
// only ever places hotel items on individual days (fd_itinerary_items), so
// hotel_id is null on every package that's ever gone through this editor and
// the old join-on-hotel_id approach always resolved hotelName to null. This
// derives it from the itinerary instead — the earliest day that has a hotel
// placed on it, resolved against the already-loaded hotel pool — which is
// what a listing actually wants to show ("the" hotel this package uses).
function deriveHotelName(items, pools) {
  const hotelItem = [...items].sort((a, b) => a.day_number - b.day_number).find((it) => it.item_type === 'hotel');
  if (!hotelItem) return null;
  return pools.hotel?.find((h) => h.id === hotelItem.item_id)?.name || null;
}

// `ratePerPax` is the already-resolved rate (see resolveRatePerPax —
// fdPackage.rate_per_pax when the admin set an override, else the itinerary
// total). Callers that haven't loaded the itinerary/catalog pools
// (create/update, which have no itinerary yet) simply omit it, so a package
// with no override and no itinerary yet reports ratePerPax: null. `hotelName`
// works the same way — omitted (falls back to the always-null legacy
// hotel_id join) by callers with no itinerary loaded yet; list()/get() below
// pass deriveHotelName's result explicitly.
// `rateOverride` is the raw column, unresolved — the editor needs this
// (rather than the resolved ratePerPax) to tell whether the admin has set a
// manual price at all, since it computes the itinerary-driven default live
// on its own instead of trusting a value that might just be the fallback.
function toPublicPackage(fdPackage, ratePerPax, hotelName) {
  return {
    id: fdPackage.id,
    title: fdPackage.title,
    theme: fdPackage.theme,
    duration: fdPackage.duration,
    heroImageUrl: fdPackage.hero_image_url,
    images: fdPackage.images || [],
    hotelId: fdPackage.hotel_id,
    hotelName: hotelName !== undefined ? hotelName : (fdPackage.hotel_name ?? null),
    shortDescription: fdPackage.short_description,
    suitableAgeMin: fdPackage.suitable_age_min,
    rating: toNumOrNull(fdPackage.rating),
    reviewCount: fdPackage.review_count,
    isFeatured: fdPackage.is_featured,
    isBestseller: fdPackage.is_bestseller,
    status: fdPackage.status,
    ratePerPax: ratePerPax ?? null,
    rateOverride: toNumOrNull(fdPackage.rate_per_pax),
    // Meals (lunch/dinner) are opt-in fd_addons rows now (0075) — they come
    // back in `addons` on get(), not as fields here.
    // Task 5 — "included or not" checkbox (0062_fd_addons_transfer_visa.sql).
    visaEnabled: !!fdPackage.visa_enabled,
    // Flights section (0064_fd_package_flights.sql) — ids only; the editor
    // resolves names/source/destination/date against its own /flights fetch
    // (same "parent already has the full catalog loaded" convention
    // AddonsManager uses for activities/tours/transfers), rather than this
    // response embedding a joined name the way hotelName above does.
    flightsEnabled: !!fdPackage.flights_enabled,
    onwardFlightId: fdPackage.onward_flight_id ?? null,
    returnFlightId: fdPackage.return_flight_id ?? null,
    // Client-facing Inclusions/Exclusions — see
    // 0050_fd_packages_inclusions_exclusions.sql.
    inclusions: fdPackage.inclusions || '',
    exclusions: fdPackage.exclusions || '',
    createdAt: fdPackage.created_at,
    // fd_packages.updated_at (0006_fd_packages.sql) — bumped to now() on every
    // updateFdPackage. Surfaced for the Product Catalog table's "Updated"
    // column; present on both list() (SELECT fd_packages.*) and get().
    updatedAt: fdPackage.updated_at,
    // Only present on the admin list() row (listAllFdPackagesForAdmin's seat
    // rollup) — undefined here on the single-package get(), which loads the
    // full departureDates array separately instead.
    seatsTotal: toNumOrNull(fdPackage.seats_total),
    seatsBooked: toNumOrNull(fdPackage.seats_booked),
    firstDepartureDate: fdPackage.first_date ?? null,
    lastDepartureDate: fdPackage.last_date ?? null,
  };
}

// GET /api/admin/fd-packages?search=&page=&pageSize=
// `search` (Product Catalog's FD Packages table) is a free-text match over
// title/theme/hotel name, applied in JS same as every other admin list's
// search (admin.controller.js#getAgencies, relationshipManagers.controller.js
// #list). `page`/`pageSize` pagination is opt-in (only applied when either is
// present) — every other existing caller of this same endpoint
// (FdPackageEditor.jsx's own related-package lookups, Team Portal's
// Catalog.jsx, ManualBookingWizard.jsx's package picker) calls it with
// neither and still gets back the full list unchanged, so none of them
// silently truncate to a page of 10.
export async function list(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store');
    const [rows, pools] = await Promise.all([listAllFdPackagesForAdmin(), loadCatalogPools()]);
    let fdPackages = await Promise.all(
      rows.map(async (row) => {
        const { items } = await listItineraryForPackage(row.id);
        return toPublicPackage(row, resolveRatePerPax(row, items, pools), deriveHotelName(items, pools));
      })
    );

    const { search } = req.query;
    if (search) {
      const needle = search.trim().toLowerCase();
      fdPackages = fdPackages.filter((p) =>
        [p.title, p.theme, p.hotelName].some((v) => v && v.toLowerCase().includes(needle))
      );
    }

    const paginate = req.query.page !== undefined || req.query.pageSize !== undefined;
    if (!paginate) {
      return res.json({ fdPackages });
    }
    const total = fdPackages.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize, 10) || 10));
    const start = (page - 1) * pageSize;
    fdPackages = fdPackages.slice(start, start + pageSize);

    res.json({ fdPackages, pagination: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const fdPackage = await findFdPackageById(req.params.id);
    if (!fdPackage) return res.status(404).json({ error: 'not_found' });

    const [itinerary, dates, addons, pools] = await Promise.all([
      listItineraryForPackage(fdPackage.id),
      listDepartureDates(fdPackage.id),
      listAddons(fdPackage.id),
      loadCatalogPools(),
    ]);

    res.json({
      fdPackage: {
        ...toPublicPackage(fdPackage, resolveRatePerPax(fdPackage, itinerary.items, pools), deriveHotelName(itinerary.items, pools)),
        itinerary: composeItinerary(itinerary.days, itinerary.items, pools),
        departureDates: dates.map((d) => ({
          id: d.id,
          date: d.date,
          seatsTotal: d.seats_total,
          seatsBooked: d.seats_booked,
          location: d.location,
        })),
        addons: addons.map((a) => ({
          id: a.id,
          activityId: a.activity_id,
          tourId: a.tour_id,
          transferId: a.transfer_id,
          flightId: a.flight_id,
          mealId: a.meal_id,
          // Meal add-ons have no per-row name of their own — label by meal
          // type (there's one lunch + one dinner catalog entry).
          name:
            a.activity_name ||
            a.tour_name ||
            a.transfer_name ||
            a.flight_name ||
            (a.meal_type ? a.meal_type[0].toUpperCase() + a.meal_type.slice(1) : a.meal_name),
          pricePerPax: Number(a.price_per_pax),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function create(req, res, next) {
  try {
    const message =
      carouselImagesError(req.body.images, req.body.status) ||
      heroImageError(req.body.heroImageUrl, req.body.status) ||
      flightsSelectionError(req.body.flightsEnabled, req.body.onwardFlightId, req.body.returnFlightId, req.body.status);
    if (message) {
      return res.status(400).json({ error: 'validation_error', message });
    }
    const fdPackage = await createFdPackage(toSnakeCaseColumns(req.body));
    res.status(201).json({ fdPackage: toPublicPackage(fdPackage) });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const existing = await findFdPackageById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    // PATCH bodies are partial — a `status: 'published'` PATCH sent without
    // `images` (or vice versa) still needs checking against whichever of the
    // two the request isn't touching, so fall back to what's already saved.
    const finalStatus = req.body.status !== undefined ? req.body.status : existing.status;
    const finalImages = req.body.images !== undefined ? req.body.images : existing.images;
    const finalHeroImageUrl = req.body.heroImageUrl !== undefined ? req.body.heroImageUrl : existing.hero_image_url;
    const finalFlightsEnabled = req.body.flightsEnabled !== undefined ? req.body.flightsEnabled : existing.flights_enabled;
    const finalOnwardFlightId = req.body.onwardFlightId !== undefined ? req.body.onwardFlightId : existing.onward_flight_id;
    const finalReturnFlightId = req.body.returnFlightId !== undefined ? req.body.returnFlightId : existing.return_flight_id;
    const message =
      carouselImagesError(finalImages, finalStatus) ||
      heroImageError(finalHeroImageUrl, finalStatus) ||
      flightsSelectionError(finalFlightsEnabled, finalOnwardFlightId, finalReturnFlightId, finalStatus);
    if (message) {
      return res.status(400).json({ error: 'validation_error', message });
    }

    const fdPackage = await updateFdPackage(req.params.id, toSnakeCaseColumns(req.body));
    if (!fdPackage) return res.status(404).json({ error: 'not_found' });
    res.json({ fdPackage: toPublicPackage(fdPackage) });
  } catch (err) {
    next(err);
  }
}

export async function remove(req, res, next) {
  try {
    const existing = await findFdPackageById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    await deleteFdPackage(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/fd-packages/:id/hero-image — multipart, requires the image file at req.file.
export async function uploadHeroImage(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await findFdPackageById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    if (!req.file) {
      return res.status(400).json({ error: 'missing_file', message: 'Upload a hero image' });
    }

    const uploaded = await uploadBuffer(req.file.buffer, {
      folderParts: ['fd-packages', id, 'hero-image'],
    });

    const fdPackage = await updateFdPackage(id, { hero_image_url: uploaded.secure_url });
    res.status(201).json({ fdPackage: toPublicPackage(fdPackage) });
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/fd-packages/:id/images — multipart, one or more files at req.files (field 'images').
export async function uploadImages(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await findFdPackageById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'missing_files', message: 'Upload at least one image' });
    }

    const uploaded = await Promise.all(
      req.files.map((file) => uploadBuffer(file.buffer, { folderParts: ['fd-packages', id, 'images'] }))
    );
    const images = [...(existing.images || []), ...uploaded.map((u) => u.secure_url)];

    const fdPackage = await updateFdPackage(id, { images });
    res.status(201).json({ fdPackage: toPublicPackage(fdPackage) });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/admin/fd-packages/:id/images/:url — :url is encodeURIComponent'd by the caller.
export async function deleteImage(req, res, next) {
  try {
    const { id } = req.params;
    const url = decodeURIComponent(req.params.url);
    const existing = await findFdPackageById(id);
    if (!existing) return res.status(404).json({ error: 'not_found' });

    const images = (existing.images || []).filter((u) => u !== url);
    const fdPackage = await updateFdPackage(id, { images });
    res.json({ fdPackage: toPublicPackage(fdPackage) });
  } catch (err) {
    next(err);
  }
}

export async function putItinerary(req, res, next) {
  try {
    const [{ days, items }, pools] = await Promise.all([
      replaceItinerary(req.params.id, req.body.days),
      loadCatalogPools(),
    ]);
    // The editor computes the itinerary-driven net rate live on its own
    // (mirrors computeNetRatePerPax) as items are added/removed, so this
    // response doesn't need to carry a price at all.
    res.json({ itinerary: composeItinerary(days, items, pools) });
  } catch (err) {
    next(err);
  }
}

export async function postDepartureDate(req, res, next) {
  try {
    const date = await addDepartureDate(req.params.id, req.body);
    res.status(201).json({ departureDate: date });
  } catch (err) {
    next(err);
  }
}

export async function deleteDepartureDate(req, res, next) {
  try {
    await removeDepartureDate(req.params.dateId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Task 5 — admin picks a real catalog item by checkbox; its price is read
// straight off that catalog entry here (never admin-typed) so it can never
// drift from what the Product Catalog actually charges elsewhere. Flights
// (0064_fd_package_flights.sql, priced via 0065_flights_price.sql) follow the
// same rule now that they have a price column — still go through the same
// "does this id actually exist" check as everything else either way.
async function resolveAddonPriceAndName({ activityId, tourId, transferId, flightId, mealId, durationDays }) {
  if (activityId) {
    const row = await activitiesModel.findById(activityId);
    if (!row) return null;
    return { pricePerPax: Number(row.price_per_pax || 0), name: row.name };
  }
  if (tourId) {
    const row = await toursModel.findById(tourId);
    if (!row) return null;
    return { pricePerPax: Number(row.price || 0), name: row.name };
  }
  if (transferId) {
    const row = await transfersModel.findById(transferId);
    if (!row) return null;
    return { pricePerPax: Number(row.price || 0), name: row.name };
  }
  if (mealId) {
    const row = await mealsModel.findById(mealId);
    if (!row) return null;
    // price_per_day × the package's Duration in days (0075) — repriced by
    // updateFdPackage if the Duration later changes.
    return {
      pricePerPax: Number(row.price_per_day || 0) * (durationDays || 0),
      name: row.meal_type ? row.meal_type[0].toUpperCase() + row.meal_type.slice(1) : row.name,
    };
  }
  const row = await flightsModel.findById(flightId);
  if (!row) return null;
  return { pricePerPax: Number(row.price || 0), name: row.name };
}

export async function postAddon(req, res, next) {
  try {
    const { activityId, tourId, transferId, flightId, mealId } = req.body;
    let durationDays = null;
    if (mealId) {
      const fdPackage = await findFdPackageById(req.params.id);
      if (!fdPackage) return res.status(404).json({ error: 'not_found' });
      durationDays = parseDurationDays(fdPackage.duration);
    }
    const resolved = await resolveAddonPriceAndName({ activityId, tourId, transferId, flightId, mealId, durationDays });
    if (!resolved) {
      return res.status(400).json({ error: 'invalid_item', message: 'That catalog item no longer exists.' });
    }

    const addon = await addAddon(req.params.id, {
      activityId,
      tourId,
      transferId,
      flightId,
      mealId,
      pricePerPax: resolved.pricePerPax,
    });
    // Mirrors the get() addons mapping above — postAddon previously returned
    // the raw snake_case DB row, so a freshly-added addon showed a blank
    // price in the UI until the page was reloaded via get().
    res.status(201).json({
      addon: {
        id: addon.id,
        activityId: addon.activity_id,
        tourId: addon.tour_id,
        transferId: addon.transfer_id,
        flightId: addon.flight_id,
        mealId: addon.meal_id,
        name: resolved.name,
        pricePerPax: resolved.pricePerPax,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteAddon(req, res, next) {
  try {
    await removeAddon(req.params.addonId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
