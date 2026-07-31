import { z } from 'zod';

// Mirrors the doc's packages/shared validation-schema concept, kept local to this
// single-backend repo since there is no shared workspace package here.

export const registerSchema = z.object({
  agencyName: z.string().min(2).max(200),
  agencyType: z.enum(['travel_agent', 'mice_company']),
  licenseNumber: z.string().max(100).optional(),
  country: z.string().min(2).max(100),
  ownerFullName: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(128),
});

export const patchAgencyMeSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  country: z.string().min(2).max(100).optional(),
  logoAssetUrl: z.string().url().optional(),
  currencyPreference: z.string().max(10).optional(),
});

export const createSubUserSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().max(30).optional(),
  permissions: z.record(z.boolean()).optional(),
});

export const patchAdminAgencySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'suspended']).optional(),
  tier: z.enum(['gold', 'silver', 'bronze']).optional(),
  creditLimit: z.number().nonnegative().optional(),
  rmUserId: z.string().uuid().nullable().optional(),
});

export const createTeamMemberSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  role: z.enum([
    'ops_admin',
    'super_admin',
    'sales_marketing',
    'support',
    'finance',
  ]),
  permissions: z.record(z.boolean()).optional(),
});

export const patchTeamMemberSchema = z.object({
  role: z
    .enum(['ops_admin', 'super_admin', 'sales_marketing', 'support', 'finance'])
    .optional(),
  permissions: z.record(z.boolean()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

// --- Catalog (doc §11.2 / §12.3) ---

export const hotelSchema = z.object({
  name: z.string().min(2).max(200),
  city: z.string().min(2).max(100),
  category: z.number().int().min(1).max(7).optional(),
  boardBasisOptions: z.array(z.string()).optional(),
  miceBallroomCapacity: z.number().int().nonnegative().optional(),
  miceBreakoutRooms: z.number().int().nonnegative().optional(),
  images: z.array(z.string()).optional(),
  description: z.string().optional(),
  isMiceEnabled: z.boolean().optional(),
});

export const tourSchema = z.object({
  name: z.string().min(2).max(200),
  city: z.string().min(2).max(100),
  description: z.string().optional(),
  duration: z.string().max(50).optional(),
  images: z.array(z.string()).optional(),
  groupSuitability: z.string().optional(),
  suitableAgeMin: z.number().int().nonnegative().optional(),
  isBestseller: z.boolean().optional(),
});

export const activitySchema = z.object({
  name: z.string().min(2).max(200),
  city: z.string().min(2).max(100),
  description: z.string().optional(),
  duration: z.string().max(50).optional(),
  images: z.array(z.string()).optional(),
  pricePerPax: z.number().nonnegative().optional(),
  suitableAgeMin: z.number().int().nonnegative().optional(),
  isBestseller: z.boolean().optional(),
});

export const transferSchema = z.object({
  name: z.string().min(2).max(200),
  type: z.enum(['airport', 'intercity', 'point_to_point', 'group_coach']),
  vehicleClass: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  description: z.string().optional(),
});

export const experienceSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  images: z.array(z.string()).optional(),
  suitableGroupSizeMin: z.number().int().nonnegative().optional(),
  suitableGroupSizeMax: z.number().int().nonnegative().optional(),
});

// camelCase request bodies -> snake_case DB columns for the catalog CRUD models.
const CATALOG_KEY_MAP = {
  boardBasisOptions: 'board_basis_options',
  miceBallroomCapacity: 'mice_ballroom_capacity',
  miceBreakoutRooms: 'mice_breakout_rooms',
  isMiceEnabled: 'is_mice_enabled',
  groupSuitability: 'group_suitability',
  suitableAgeMin: 'suitable_age_min',
  isBestseller: 'is_bestseller',
  pricePerPax: 'price_per_pax',
  vehicleClass: 'vehicle_class',
  suitableGroupSizeMin: 'suitable_group_size_min',
  suitableGroupSizeMax: 'suitable_group_size_max',
};

export function toSnakeCaseColumns(body) {
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    out[CATALOG_KEY_MAP[key] || key] = value;
  }
  return out;
}

// --- Fixed Group Departures (doc §11.3 / §12.4) ---

export const fdPackageSchema = z.object({
  title: z.string().min(2).max(200),
  theme: z.string().max(100).optional(),
  duration: z.string().max(50).optional(),
  heroImageUrl: z.string().optional(),
  shortDescription: z.string().optional(),
  suitableAgeMin: z.number().int().nonnegative().optional(),
  isFeatured: z.boolean().optional(),
  isBestseller: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'closed']).optional(),
  depositAmount: z.number().nonnegative().optional(),
  balanceDueDaysBefore: z.number().int().nonnegative().optional(),
  rateGold: z.number().nonnegative().optional(),
  rateSilver: z.number().nonnegative().optional(),
  rateBronze: z.number().nonnegative().optional(),
});

export const fdItineraryDaySchema = z.object({
  dayNumber: z.number().int().positive(),
  description: z.string().min(1),
});

export const fdDepartureDateSchema = z.object({
  date: z.string(), // ISO date
  seatsTotal: z.number().int().nonnegative(),
});

export const fdAddonSchema = z
  .object({
    activityId: z.string().uuid().optional(),
    tourId: z.string().uuid().optional(),
    pricePerPax: z.number().nonnegative(),
  })
  .refine((v) => Boolean(v.activityId) !== Boolean(v.tourId), {
    message: 'Provide exactly one of activityId or tourId',
  });

export const createBookingSchema = z.object({
  departureDateId: z.string().uuid(),
  pax: z.number().int().positive(),
  addonIds: z.array(z.string().uuid()).optional(),
  travelers: z
    .array(
      z.object({
        name: z.string().min(1),
        passportNo: z.string().optional(),
        dob: z.string().optional(),
        roomShareGroup: z.string().optional(),
      })
    )
    .optional(),
});

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'validation_error',
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    next();
  };
}
