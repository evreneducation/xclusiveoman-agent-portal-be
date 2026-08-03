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

function toPublicPackage(fdPackage) {
  return {
    id: fdPackage.id,
    title: fdPackage.title,
    theme: fdPackage.theme,
    duration: fdPackage.duration,
    heroImageUrl: fdPackage.hero_image_url,
    images: fdPackage.images || [],
    shortDescription: fdPackage.short_description,
    suitableAgeMin: fdPackage.suitable_age_min,
    rating: fdPackage.rating,
    reviewCount: fdPackage.review_count,
    isFeatured: fdPackage.is_featured,
    isBestseller: fdPackage.is_bestseller,
    status: fdPackage.status,
    depositAmount: fdPackage.deposit_amount,
    balanceDueDaysBefore: fdPackage.balance_due_days_before,
    rateGold: fdPackage.rate_gold,
    rateSilver: fdPackage.rate_silver,
    rateBronze: fdPackage.rate_bronze,
    createdAt: fdPackage.created_at,
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
        })),
        addons: addons.map((a) => ({
          id: a.id,
          activityId: a.activity_id,
          tourId: a.tour_id,
          name: a.activity_name || a.tour_name,
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
    res.status(201).json({ addon });
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
