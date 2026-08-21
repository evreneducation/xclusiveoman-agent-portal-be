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
import { activitiesModel, toursModel, transfersModel } from '../models/catalog.model.js';
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

// `ratePerPax` is the already-resolved rate (see resolveRatePerPax —
// fdPackage.rate_per_pax when the admin set an override, else the itinerary
// total). Callers that haven't loaded the itinerary/catalog pools
// (create/update, which have no itinerary yet) simply omit it, so a package
// with no override and no itinerary yet reports ratePerPax: null.
// `rateOverride` is the raw column, unresolved — the editor needs this
// (rather than the resolved ratePerPax) to tell whether the admin has set a
// manual price at all, since it computes the itinerary-driven default live
// on its own instead of trusting a value that might just be the fallback.
function toPublicPackage(fdPackage, ratePerPax) {
  return {
    id: fdPackage.id,
    title: fdPackage.title,
    theme: fdPackage.theme,
    duration: fdPackage.duration,
    heroImageUrl: fdPackage.hero_image_url,
    images: fdPackage.images || [],
    hotelId: fdPackage.hotel_id,
    hotelName: fdPackage.hotel_name ?? null,
    shortDescription: fdPackage.short_description,
    suitableAgeMin: fdPackage.suitable_age_min,
    rating: toNumOrNull(fdPackage.rating),
    reviewCount: fdPackage.review_count,
    isFeatured: fdPackage.is_featured,
    isBestseller: fdPackage.is_bestseller,
    status: fdPackage.status,
    ratePerPax: ratePerPax ?? null,
    rateOverride: toNumOrNull(fdPackage.rate_per_pax),
    // Raw meal selection — the editor resolves these against its own /meals
    // fetch to compute a live cost, the same way it does for itinerary items.
    lunchMealId: fdPackage.lunch_meal_id ?? null,
    lunchPeople: toNumOrNull(fdPackage.lunch_people),
    lunchDays: toNumOrNull(fdPackage.lunch_days),
    dinnerMealId: fdPackage.dinner_meal_id ?? null,
    dinnerPeople: toNumOrNull(fdPackage.dinner_people),
    dinnerDays: toNumOrNull(fdPackage.dinner_days),
    // Task 5 — "included or not" checkbox (0062_fd_addons_transfer_visa.sql).
    visaEnabled: !!fdPackage.visa_enabled,
    // Client-facing Inclusions/Exclusions — see
    // 0050_fd_packages_inclusions_exclusions.sql.
    inclusions: fdPackage.inclusions || '',
    exclusions: fdPackage.exclusions || '',
    createdAt: fdPackage.created_at,
    // Only present on the admin list() row (listAllFdPackagesForAdmin's seat
    // rollup) — undefined here on the single-package get(), which loads the
    // full departureDates array separately instead.
    seatsTotal: toNumOrNull(fdPackage.seats_total),
    seatsBooked: toNumOrNull(fdPackage.seats_booked),
    firstDepartureDate: fdPackage.first_date ?? null,
    lastDepartureDate: fdPackage.last_date ?? null,
  };
}

export async function list(req, res, next) {
  try {
    const [rows, pools] = await Promise.all([listAllFdPackagesForAdmin(), loadCatalogPools()]);
    const fdPackages = await Promise.all(
      rows.map(async (row) => {
        const { items } = await listItineraryForPackage(row.id);
        return toPublicPackage(row, resolveRatePerPax(row, items, pools));
      })
    );
    res.json({ fdPackages });
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
        ...toPublicPackage(fdPackage, resolveRatePerPax(fdPackage, itinerary.items, pools)),
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
          name: a.activity_name || a.tour_name || a.transfer_name,
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
    const message = carouselImagesError(req.body.images, req.body.status);
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
    const message = carouselImagesError(finalImages, finalStatus);
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
// drift from what the Product Catalog actually charges elsewhere.
async function resolveAddonPriceAndName({ activityId, tourId, transferId }) {
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
  const row = await transfersModel.findById(transferId);
  if (!row) return null;
  return { pricePerPax: Number(row.price || 0), name: row.name };
}

export async function postAddon(req, res, next) {
  try {
    const { activityId, tourId, transferId } = req.body;
    const resolved = await resolveAddonPriceAndName({ activityId, tourId, transferId });
    if (!resolved) {
      return res.status(400).json({ error: 'invalid_item', message: 'That catalog item no longer exists.' });
    }

    const addon = await addAddon(req.params.id, { activityId, tourId, transferId, pricePerPax: resolved.pricePerPax });
    // Mirrors the get() addons mapping above — postAddon previously returned
    // the raw snake_case DB row, so a freshly-added addon showed a blank
    // price in the UI until the page was reloaded via get().
    res.status(201).json({
      addon: {
        id: addon.id,
        activityId: addon.activity_id,
        tourId: addon.tour_id,
        transferId: addon.transfer_id,
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
