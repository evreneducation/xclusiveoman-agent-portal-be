import { z } from 'zod';
import { isValidTimeZone, zonedDateTimeToUtc } from '../utils/timezone.js';

// Mirrors the doc's packages/shared validation-schema concept, kept local to this
// single-backend repo since there is no shared workspace package here.

export const registerSchema = z.object({
  agencyName: z.string().min(2).max(200),
  agencyType: z.enum(['travel_agent', 'mice_company']),
  licenseNumber: z.string().max(100).optional(),
  country: z.string().min(2).max(100),
  ownerFullName: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().min(1, 'Phone is required').max(30),
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

// --- Relationship Managers (doc §4 role table, REL-1/REL-2) ---

export const createRelationshipManagerSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
});

export const patchRelationshipManagerSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

// --- Sales Managers ---
// Admin-creatable staff is limited to the relationship-manager and
// sales-manager pools (this schema + the RM one above) — the previous
// generic /admin/team CRUD (any staff role, including super_admin) was
// removed in favor of these two dedicated, narrowly-scoped flows.

export const createSalesManagerSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
});

export const patchSalesManagerSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

// --- Catalog (doc §11.2 / §12.3) ---

export const hotelSchema = z.object({
  name: z.string().min(2).max(200),
  city: z.string().min(2).max(100),
  state: z.string().min(2).max(100),
  address: z.string().min(1).max(500),
  email: z.string().email('Enter a valid email address'),
  // Star category — dropdown limited to 3/4/5 stars, reuses the existing
  // `category` column rather than adding a duplicate field.
  category: z.number().int().refine((v) => [3, 4, 5].includes(v), {
    message: 'Star category must be 3, 4, or 5',
  }),
  images: z.array(z.string()).min(1, 'Upload at least one image'),
  description: z.string().min(1, 'Description is required'),
  pricePerNight: z.number().positive('Price must be a positive number'),
  boardBasisOptions: z.array(z.string()).optional(),
  miceBallroomCapacity: z.number().int().nonnegative().optional(),
  miceBreakoutRooms: z.number().int().nonnegative().optional(),
  isMiceEnabled: z.boolean().optional(),
});

export const tourSchema = z.object({
  name: z.string().min(2).max(200),
  city: z.string().min(2).max(100),
  description: z.string().min(1, 'Description is required'),
  duration: z.string().min(1, 'Duration is required').max(50),
  images: z.array(z.string()).min(1, 'Upload at least one image'),
  category: z.string().min(1, 'Tour category is required').max(100),
  price: z.number().positive('Price must be a positive number'),
  groupSuitability: z.string().optional(),
  suitableAgeMin: z.number().int().nonnegative().optional(),
  isBestseller: z.boolean().optional(),
  isMiceEnabled: z.boolean().optional(),
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
  isMiceEnabled: z.boolean().optional(),
});

export const transferSchema = z.object({
  name: z.string().min(2).max(200),
  type: z.enum(['airport', 'intercity', 'point_to_point', 'group_coach']),
  vehicleClass: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  description: z.string().optional(),
  // Feeds the Quote Details "Landing Cost Breakdown" auto-calculation —
  // optional (unlike hotel/tour price) since existing transfers predate it.
  price: z.number().nonnegative().optional(),
  // Optional like activities' images (0029_transfer_images.sql) — unlike
  // hotel/tour images, not required, since existing transfers predate it.
  images: z.array(z.string()).optional(),
  isMiceEnabled: z.boolean().optional(),
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
  pricePerNight: 'price_per_night',
  vehicleClass: 'vehicle_class',
  suitableGroupSizeMin: 'suitable_group_size_min',
  suitableGroupSizeMax: 'suitable_group_size_max',
  // FD packages (fdPackageSchema) — these were missing, which silently dropped
  // them from every create/update since FD_COLUMNS looks up the snake_case key.
  heroImageUrl: 'hero_image_url',
  hotelId: 'hotel_id',
  shortDescription: 'short_description',
  isFeatured: 'is_featured',
  depositAmount: 'deposit_amount',
  balanceDueDaysBefore: 'balance_due_days_before',
  rateGold: 'rate_gold',
  rateSilver: 'rate_silver',
  rateBronze: 'rate_bronze',
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
  images: z.array(z.string()).optional(),
  hotelId: z.string().uuid().nullable().optional(),
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

export const fdDepartureDateSchema = z.object({
  date: z.string(), // ISO date
  seatsTotal: z.number().int().nonnegative(),
  location: z.string().min(1, 'Location is required').max(100), // e.g. "Mumbai" — picked from GET /departure-locations
});

export const fdAddonSchema = z
  .object({
    activityId: z.string().uuid().optional(),
    tourId: z.string().uuid().optional(),
    location: z.string().min(1).max(100).optional(),
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

// --- Custom FIT Package Builder (doc §6.2 / §9.3 / FIT-1..FIT-7) ---

// Passport is required for adult travelers only — isChild (backed by
// package_request_travelers.is_child) is what the PackageBuilder's
// Traveller Details step uses to decide whether to even show the field.
const packageRequestTravelerSchema = z
  .object({
    name: z.string().min(1),
    passportNo: z.string().optional(),
    dob: z.string().optional(),
    roomShareGroup: z.string().optional(),
    isChild: z.boolean().optional().default(false),
  })
  .refine((v) => v.isChild || !!v.passportNo?.trim(), {
    message: 'Passport number is required for adult travelers',
    path: ['passportNo'],
  });

// Day-wise Itinerary Planner (FIT-5). `items` references are trusted at the
// shape level only (uuid + a known type) — the controller resolves each
// against the request's own selected hotels/tours/transfers/activities, so a
// stray id for something never selected just fails to resolve a name rather
// than needing its own rejection path here.
export const itineraryDaySchema = z.object({
  dayNumber: z.number().int().positive(),
  notes: z.string().max(2000).optional().default(''),
  items: z
    .array(
      z.object({
        type: z.enum(['hotel', 'tour', 'transfer', 'activity']),
        id: z.string().uuid(),
        // Per-item annotation (e.g. "9am pickup"), separate from the day's
        // own `notes` above.
        note: z.string().max(500).optional().default(''),
      })
    )
    .optional()
    .default([]),
});

export const itinerarySchema = z.array(itineraryDaySchema).optional().default([]);

export const createPackageRequestSchema = z
  .object({
    destination: z.string().min(2, 'Destination is required').max(200),
    dateFrom: z.string().min(1, 'Travel start date is required'),
    dateTo: z.string().min(1, 'Travel end date is required'),
    paxAdults: z.number().int().positive('At least one adult is required'),
    paxChildren: z.number().int().nonnegative().optional().default(0),
    hotelIds: z.array(z.string().uuid()).min(1, 'Select a hotel'),
    tourIds: z.array(z.string().uuid()).optional().default([]),
    transferIds: z.array(z.string().uuid()).optional().default([]),
    activityIds: z.array(z.string().uuid()).optional().default([]),
    travelers: z.array(packageRequestTravelerSchema).min(1, 'Add at least one traveller'),
    itinerary: itinerarySchema,
  })
  // Plain string comparisons — dateFrom/dateTo are always "YYYY-MM-DD" (no
  // time/timezone component) coming from the FE's <input type="date">, so
  // lexicographic order already matches chronological order without the
  // Date-parsing timezone pitfalls that come with mixing UTC- and
  // local-parsed dates.
  .refine((v) => v.dateFrom <= v.dateTo, {
    message: 'End date cannot be earlier than the start date.',
    path: ['dateTo'],
  })
  .refine((v) => v.dateFrom >= new Date().toISOString().slice(0, 10), {
    message: 'Start date cannot be in the past.',
    path: ['dateFrom'],
  });

// Agent Quote lifecycle — Draft Quotes (item 1). Deliberately lenient: a
// half-built package (no destination yet, no hotel picked, a traveler row
// with just a name typed) must save without tripping createPackageRequestSchema's
// strict rules above — those still gate the final POST .../submit.
const draftPackageRequestTravelerSchema = z.object({
  name: z.string().max(200).optional().default(''),
  passportNo: z.string().optional(),
  dob: z.string().optional(),
  roomShareGroup: z.string().optional(),
  isChild: z.boolean().optional().default(false),
});

export const draftPackageRequestSchema = z.object({
  destination: z.string().max(200).optional().default(''),
  dateFrom: z.string().optional().nullable(),
  dateTo: z.string().optional().nullable(),
  paxAdults: z.number().int().positive().optional().default(1),
  paxChildren: z.number().int().nonnegative().optional().default(0),
  hotelIds: z.array(z.string().uuid()).optional().default([]),
  tourIds: z.array(z.string().uuid()).optional().default([]),
  transferIds: z.array(z.string().uuid()).optional().default([]),
  activityIds: z.array(z.string().uuid()).optional().default([]),
  travelers: z.array(draftPackageRequestTravelerSchema).optional().default([]),
  itinerary: itinerarySchema,
});

// Agent Quote lifecycle — item 5 (Accept / Request Revision / Decline a
// Published quote). Revision comments are how the agent tells the admin
// what to change, so they're required for that one action.
export const respondPackageRequestSchema = z
  .object({
    action: z.enum(['accept', 'revision', 'decline']),
    comments: z.string().max(2000).optional(),
  })
  .refine((v) => v.action !== 'revision' || !!v.comments?.trim(), {
    message: 'Add a comment describing what needs to change',
    path: ['comments'],
  });

// --- Admin Quote Inbox — Custom FIT (doc §12.5 lead-manager route, REL-3) ---

export const assignPackageRequestLeadManagerSchema = z.object({
  leadManagerUserId: z.string().uuid().nullable(),
});

// Quote Details — Editable Costing + Markup Panel. The FE always sends the
// full costing state on every save ("Save Draft"/"Publish Quote"), so these
// aren't `.optional()` — `null` on a *Cost field means "cleared, use the
// Product Catalog auto total" (doc §2 "override any automatically calculated
// amount"), distinct from a real 0.
export const packageRequestCostingSchema = z.object({
  hotelCost: z.number().nonnegative().nullable(),
  tourCost: z.number().nonnegative().nullable(),
  transferCost: z.number().nonnegative().nullable(),
  extraCost: z.number().nonnegative().nullable(),
  markupType: z.enum(['percentage', 'fixed']),
  markupValue: z.number().nonnegative(),
  internalNotes: z.string().max(5000).optional().default(''),
});

// --- MICE Booking Engine (doc §6.3 / §9.4, MICE-1..MICE-7) ---
// Submit-in-one-call, same shape as the original (pre-draft)
// createPackageRequestSchema — still used directly by POST /mice/rfqs and by
// POST /mice/rfqs/:id/submit (an existing draft's final validation).

export const createMiceRfqSchema = z
  .object({
    destination: z.string().min(2, 'Destination is required').max(200),
    groupSize: z.number().int().positive('Group size is required'),
    eventDateFrom: z.string().min(1, 'Event start date is required'),
    eventDateTo: z.string().min(1, 'Event end date is required'),
    hallCapacityNeeded: z.number().int().positive().optional(),
    seatingStyle: z.string().max(100).optional(),
    avNeeds: z.string().max(1000).optional(),
    otherRequirements: z.string().max(2000).optional(),
    // MICE-2/MICE-7: "up to 3 hotels", server-enforced.
    hotelIds: z.array(z.string().uuid()).min(1, 'Select at least one hotel').max(3, 'Select up to 3 hotels'),
    tourIds: z.array(z.string().uuid()).optional().default([]),
    transferIds: z.array(z.string().uuid()).optional().default([]),
    activityIds: z.array(z.string().uuid()).optional().default([]),
    // Day-wise Itinerary Planner — same shape/rules as package_requests'
    // itinerary (itineraryDaySchema above); `items` here just arrange
    // whichever of hotelIds/tourIds/transferIds/activityIds above were
    // already selected, resolved by the controller the same way.
    itinerary: itinerarySchema,
  })
  .refine((v) => new Date(v.eventDateFrom) <= new Date(v.eventDateTo), {
    message: 'Event end date must be on or after the start date',
    path: ['eventDateTo'],
  });

// Agent MICE Request workflow — MICE Drafts (item 1). Deliberately lenient:
// a half-built RFQ (no destination yet, no hotel picked) must save without
// tripping createMiceRfqSchema's strict rules above — those still gate the
// final POST .../submit. The 3-hotel cap still applies even while drafting.
export const draftMiceRfqSchema = z.object({
  destination: z.string().max(200).optional().default(''),
  groupSize: z.number().int().positive().optional().nullable(),
  eventDateFrom: z.string().optional().nullable(),
  eventDateTo: z.string().optional().nullable(),
  hallCapacityNeeded: z.number().int().positive().optional().nullable(),
  seatingStyle: z.string().max(100).optional(),
  avNeeds: z.string().max(1000).optional(),
  otherRequirements: z.string().max(2000).optional(),
  hotelIds: z.array(z.string().uuid()).max(3, 'Select up to 3 hotels').optional().default([]),
  tourIds: z.array(z.string().uuid()).optional().default([]),
  transferIds: z.array(z.string().uuid()).optional().default([]),
  activityIds: z.array(z.string().uuid()).optional().default([]),
  itinerary: itinerarySchema,
});

// Agent MICE Request workflow — item 5 (Accept / Request Revision / Decline
// a Published proposal). Revision comments are how the agent tells the
// admin what to change, so they're required for that one action.
export const respondMiceRfqSchema = z
  .object({
    action: z.enum(['accept', 'revision', 'decline']),
    comments: z.string().max(2000).optional(),
  })
  .refine((v) => v.action !== 'revision' || !!v.comments?.trim(), {
    message: 'Add a comment describing what needs to change',
    path: ['comments'],
  });

// --- Admin MICE Request Management (this task's lead-manager route, REL-3) ---

export const assignMiceRfqLeadManagerSchema = z.object({
  leadManagerUserId: z.string().uuid().nullable(),
});

// MICE Request Detail — Costing & Markup Panel. Same shape/semantics as
// packageRequestCostingSchema above ("Save Draft" always sends the full
// costing state; `null` on a *Cost field means "cleared, use the Product
// Catalog auto total") — venueCost/miscellaneousCost have no catalog source
// so their auto is always 0, but they're still overridable the same way.
export const miceRfqCostingSchema = z.object({
  hotelCost: z.number().nonnegative().nullable(),
  toursActivitiesCost: z.number().nonnegative().nullable(),
  transferCost: z.number().nonnegative().nullable(),
  venueCost: z.number().nonnegative().nullable(),
  miscellaneousCost: z.number().nonnegative().nullable(),
  markupType: z.enum(['percentage', 'fixed']),
  markupValue: z.number().nonnegative(),
  internalNotes: z.string().max(5000).optional().default(''),
});

// --- Marketing Center (Task 5 — Send Test / Send Campaign) ---

const MARKETING_CHANNELS = ['email', 'whatsapp'];
const MARKETING_PROVIDERS = ['mailchimp', 'zoho', 'built_in', 'whatsapp_business_api'];
const MARKETING_AUDIENCE_TYPES = ['all', 'tier', 'country', 'inactive_30d'];
// Only 'built_in' has a real send path today (no Mailchimp/Zoho/WhatsApp
// Business API integration exists — see marketing.controller.js); the
// schema still accepts every enum value so an unconfigured provider gets a
// clear, specific "not configured" error from the controller rather than a
// generic validation failure that reads like a frontend bug.
const CHANNEL_PROVIDERS = {
  email: ['mailchimp', 'zoho', 'built_in'],
  whatsapp: ['whatsapp_business_api'],
};

// Shared by both schemas below: provider must actually belong to the
// selected channel (mirrors the frontend's Task 2 Channel section, which
// never lets these mismatch through its own UI — this is the server-side
// backstop), and Email needs a non-blank Subject the same way Task 4's
// Message card requires one before Send Campaign is enabled client-side.
function withMarketingCrossFieldRules(schema) {
  return schema
    .refine((v) => CHANNEL_PROVIDERS[v.channel]?.includes(v.provider), {
      message: 'This provider is not available for the selected channel',
      path: ['provider'],
    })
    .refine((v) => v.channel !== 'email' || !!v.subject?.trim(), {
      message: 'Subject is required for email campaigns',
      path: ['subject'],
    });
}

export const sendMarketingTestSchema = withMarketingCrossFieldRules(
  z.object({
    channel: z.enum(MARKETING_CHANNELS),
    provider: z.enum(MARKETING_PROVIDERS),
    subject: z.string().max(150).optional(),
    body: z.string().min(1, 'Message body is required').max(20000),
    recipientEmail: z.string().email(),
  })
);

export const createMarketingCampaignSchema = withMarketingCrossFieldRules(
  z
    .object({
      name: z.string().min(2, 'Campaign name is required').max(200),
      channel: z.enum(MARKETING_CHANNELS),
      provider: z.enum(MARKETING_PROVIDERS),
      audienceType: z.enum(MARKETING_AUDIENCE_TYPES),
      audienceValue: z.string().max(100).optional(),
      subject: z.string().max(150).optional(),
      body: z.string().min(1, 'Message body is required').max(20000),
      replyToAccountManager: z.boolean().optional().default(false),
    })
    .refine((v) => v.audienceType !== 'tier' || ['gold', 'silver', 'bronze'].includes(v.audienceValue), {
      message: 'Select a valid tier',
      path: ['audienceValue'],
    })
    .refine((v) => v.audienceType !== 'country' || !!v.audienceValue?.trim(), {
      message: 'Select a country',
      path: ['audienceValue'],
    })
);

// --- Marketing Center (Task 6 — Schedule Campaign) ---

// Same shape/cross-field rules as createMarketingCampaignSchema above, plus
// the three schedule fields and the actual "must be in the future" check —
// the real enforcement of that rule (the frontend's own check is UX only,
// never trusted here). scheduledDate/scheduledTime are plain digit strings
// (not z.string().datetime() etc.) since they're wall-clock components in
// an admin-chosen zone, not a single ISO instant — utils/timezone.js is the
// one place that combines the three into a real UTC instant.
export const scheduleMarketingCampaignSchema = withMarketingCrossFieldRules(
  z
    .object({
      name: z.string().min(2, 'Campaign name is required').max(200),
      channel: z.enum(MARKETING_CHANNELS),
      provider: z.enum(MARKETING_PROVIDERS),
      audienceType: z.enum(MARKETING_AUDIENCE_TYPES),
      audienceValue: z.string().max(100).optional(),
      subject: z.string().max(150).optional(),
      body: z.string().min(1, 'Message body is required').max(20000),
      replyToAccountManager: z.boolean().optional().default(false),
      scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
      scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a valid time'),
      scheduledTimezone: z.string().min(1, 'Select a timezone'),
    })
    .refine((v) => v.audienceType !== 'tier' || ['gold', 'silver', 'bronze'].includes(v.audienceValue), {
      message: 'Select a valid tier',
      path: ['audienceValue'],
    })
    .refine((v) => v.audienceType !== 'country' || !!v.audienceValue?.trim(), {
      message: 'Select a country',
      path: ['audienceValue'],
    })
    .refine((v) => isValidTimeZone(v.scheduledTimezone), {
      message: 'Unrecognised timezone',
      path: ['scheduledTimezone'],
    })
    .refine(
      (v) => {
        if (!isValidTimeZone(v.scheduledTimezone)) return true; // already reported by the refine above
        const at = zonedDateTimeToUtc(v.scheduledDate, v.scheduledTime, v.scheduledTimezone);
        return !!at && at.getTime() > Date.now();
      },
      { message: 'Scheduled time must be in the future', path: ['scheduledDate'] }
    )
);

// "depositAmount" -> "Deposit amount"
function humanizeField(field) {
  const spaced = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Zod's default messages ("Expected number, received string", "Required")
// are accurate but read like internal type-checker output. Reword the common
// ones into plain language a non-dev admin user can act on — no mention of
// JS types like "string"/"undefined".
function humanizeIssueMessage(msg) {
  const typeMismatch = msg.match(/^Expected (\w+), received (\w+)$/);
  if (typeMismatch) {
    const [, expected, received] = typeMismatch;
    if (received === 'undefined') return 'is required';
    const article = /^[aeiou]/i.test(expected) ? 'an' : 'a';
    return `must be ${article} valid ${expected}`;
  }
  if (msg === 'Required') return 'is required';
  if (/^Invalid /.test(msg)) return msg.replace(/^Invalid (\w+)$/, 'is not a valid $1');
  return msg;
}

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.flatten();
      const fieldMessages = Object.entries(details.fieldErrors).map(
        ([field, messages]) => `${humanizeField(field)} ${humanizeIssueMessage(messages[0])}`
      );
      const message = [...details.formErrors, ...fieldMessages].join('; ') || 'Invalid request';

      return res.status(400).json({
        error: 'validation_error',
        message,
        details,
      });
    }
    req.body = result.data;
    next();
  };
}
