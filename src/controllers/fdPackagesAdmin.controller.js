import {
  listAllFdPackagesForAdmin,
  findFdPackageById,
  createFdPackage,
  updateFdPackage,
  listItineraryDays,
  replaceItineraryDays,
  listDepartureDates,
  addDepartureDate,
  removeDepartureDate,
  listAddons,
  addAddon,
  removeAddon,
} from '../models/fdPackages.model.js';
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

function toPublicPackage(fdPackage) {
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
    depositAmount: toNumOrNull(fdPackage.deposit_amount),
    balanceDueDaysBefore: fdPackage.balance_due_days_before,
    rateGold: toNumOrNull(fdPackage.rate_gold),
    rateSilver: toNumOrNull(fdPackage.rate_silver),
    rateBronze: toNumOrNull(fdPackage.rate_bronze),
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
    const rows = await listAllFdPackagesForAdmin();
    res.json({ fdPackages: rows.map(toPublicPackage) });
  } catch (err) {
    next(err);
  }
}

export async function get(req, res, next) {
  try {
    const fdPackage = await findFdPackageById(req.params.id);
    if (!fdPackage) return res.status(404).json({ error: 'not_found' });

    const [itinerary, dates, addons] = await Promise.all([
      listItineraryDays(fdPackage.id),
      listDepartureDates(fdPackage.id),
      listAddons(fdPackage.id),
    ]);

    res.json({
      fdPackage: {
        ...toPublicPackage(fdPackage),
        itinerary: itinerary.map((d) => ({ id: d.id, dayNumber: d.day_number, description: d.description })),
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
          name: a.activity_name || a.tour_name,
          location: a.location,
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
    const fdPackage = await createFdPackage(toSnakeCaseColumns(req.body));
    res.status(201).json({ fdPackage: toPublicPackage(fdPackage) });
  } catch (err) {
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const fdPackage = await updateFdPackage(req.params.id, toSnakeCaseColumns(req.body));
    if (!fdPackage) return res.status(404).json({ error: 'not_found' });
    res.json({ fdPackage: toPublicPackage(fdPackage) });
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
    const days = await replaceItineraryDays(req.params.id, req.body.days);
    res.json({ itinerary: days.map((d) => ({ id: d.id, dayNumber: d.day_number, description: d.description })) });
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

export async function postAddon(req, res, next) {
  try {
    const addon = await addAddon(req.params.id, req.body);
    // Mirrors the get() addons mapping below — postAddon previously returned
    // the raw snake_case DB row, so a freshly-added addon showed a blank
    // price/location in the UI until the page was reloaded via get().
    res.status(201).json({
      addon: {
        id: addon.id,
        activityId: addon.activity_id,
        tourId: addon.tour_id,
        location: addon.location,
        pricePerPax: Number(addon.price_per_pax),
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
