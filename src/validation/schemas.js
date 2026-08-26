import { z } from 'zod';
import { isValidTimeZone, zonedDateTimeToUtc } from '../utils/timezone.js';

// Mirrors the doc's packages/shared validation-schema concept, kept local to this
// single-backend repo since there is no shared workspace package here.

export const registerSchema = z.object({
  agencyName: z.string().min(2).max(200),
  // 'mice_company' dropped from self-service Sign Up — the Agency Type
  // picker (Register.jsx) now only ever offers Travel Agent, so this
  // endpoint no longer accepts anything else. The agency_type DB enum still
  // has 'mice_company' (existing agencies, and it's still assignable
  // elsewhere e.g. admin-created agencies) — only the public registration
  // API stopped accepting it.
  agencyType: z.literal('travel_agent'),
  licenseNumber: z.string().max(100).optional(),
  // IATA/License proof is now a mandatory upload (registerLicenseDocument
  // below, POST /auth/register/license-document) rather than optional
  // free-text — this is the URL that upload returns, not a file itself
  // (this schema validates the JSON /register body; the document was
  // already uploaded to Cloudinary in a separate prior request).
  licenseDocumentUrl: z.string().url(),
  country: z.string().min(2).max(100),
  ownerFullName: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().min(1, 'Phone is required').max(30),
});

// Email OTP login is the sole sign-in mechanism now — no password anywhere
// (users.password_hash was dropped, 0060_drop_password.sql). loginSchema/
// forgotPasswordSchema/resetPasswordSchema and their controller functions/
// routes were removed in the same change, not just left dormant, since the
// column their logic depended on no longer exists.
export const requestOtpSchema = z.object({
  email: z.string().email(),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
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

// Access Features — the checkbox set an admin picks for this RM (config/
// accessFeatures.js#RM_FEATURE_KEYS is the single source of truth for which
// keys exist; kept in sync here by hand since zod has no way to import that
// array into a static object shape). Every key is optional on its own —
// relationshipManagers.controller.js#normalizeRmPermissions fills in
// whichever keys are omitted from RM_DEFAULT_PERMISSIONS, so a caller only
// has to send the ones it's actually changing.
export const rmPermissionsSchema = z
  .object({
    approvedAgents: z.boolean().optional(),
    quotesPricing: z.boolean().optional(),
    supportTickets: z.boolean().optional(),
    bookingsDocs: z.boolean().optional(),
  })
  .partial();

export const createRelationshipManagerSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  permissions: rmPermissionsSchema.optional(),
});

export const patchRelationshipManagerSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  permissions: rmPermissionsSchema.optional(),
});

// --- Sales Managers ---
// Admin-creatable staff is limited to the relationship-manager and
// sales-manager pools (this schema + the RM one above) — the previous
// generic /admin/team CRUD (any staff role, including super_admin) was
// removed in favor of these two dedicated, narrowly-scoped flows.

// Access Features — mirrors rmPermissionsSchema above, keyed off config/
// accessFeatures.js#LM_FEATURE_KEYS instead.
export const lmPermissionsSchema = z
  .object({
    catalog: z.boolean().optional(),
    quotesPricing: z.boolean().optional(),
    bookingsDocs: z.boolean().optional(),
    fdOperations: z.boolean().optional(),
  })
  .partial();

export const createSalesManagerSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  permissions: lmPermissionsSchema.optional(),
});

export const patchSalesManagerSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  permissions: lmPermissionsSchema.optional(),
});

// --- Custom-role employees ---
// Employees & Roles' unified "Add" button (Employees.jsx) added a third
// option beyond the RM/LM schemas above — "Other", a free-text role typed
// by the admin (product decision: saved straight into users.role, no
// Access Features, no /team login routing yet — see
// customRoleEmployees.controller.js#create's own comment). This is exactly
// the kind of "any staff role, including super_admin" free-for-all the
// comment above says was already tried and removed once — RESERVED_ROLES
// keeps this from reopening that hole: every role name this app's own
// requireRole(...) gates already check for is off-limits here, so this can
// only ever mint a label with no built-in privileges, never impersonate an
// existing one by typing its name.
const RESERVED_ROLES = new Set([
  'agency_owner',
  'agency_staff',
  'ops_admin',
  'super_admin',
  'sales_marketing',
  'support',
  'finance',
  'relationship_manager',
  'sales_manager',
]);

// Generic basic-field edit (employees.controller.js#update) for any staff
// user regardless of role — no `permissions` field, deliberately: Access
// Features only exist for the RM/LM schemas above, which keep their own
// dedicated PATCH endpoints for that.
export const patchGenericEmployeeSchema = z.object({
  fullName: z.string().min(2).max(200).optional(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const createCustomRoleEmployeeSchema = z.object({
  fullName: z.string().min(2).max(200),
  email: z.string().email(),
  phone: z.string().max(30).optional(),
  whatsappNumber: z.string().max(30).optional(),
  role: z
    .string()
    .min(2)
    .max(60)
    .transform((s) => s.trim().toLowerCase().replace(/\s+/g, '_'))
    .refine((r) => /^[a-z][a-z0-9_]*$/.test(r), 'Role can only contain letters, numbers, and spaces')
    .refine((r) => !RESERVED_ROLES.has(r), 'That role name is already used by a built-in role'),
});

// --- Catalog (doc §11.2 / §12.3) ---

// name/city/state/address/email/category/images/description all used to be
// required here unconditionally — that's what made it impossible to ever
// create a hotel row before every field was filled in. 0070_hotels_status.sql
// moves "must be complete" to a publish-time gate instead (requireHotelPublishFields,
// catalog.routes.js — same "only checked at the moment of publishing" shape
// FD packages use for carousel images/flights), same as this schema already
// did for "at least one occupancy price" below; each field here still
// validates its own format/type when present, just isn't required to be
// present, so a half-filled draft (HotelEditor.jsx's autosave) can save.
export const hotelSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  city: z.string().min(2).max(100).optional(),
  state: z.string().min(2).max(100).optional(),
  address: z.string().min(1).max(500).optional(),
  email: z.string().email('Enter a valid email address').optional(),
  // Star category — dropdown limited to 3/4/5 stars, reuses the existing
  // `category` column rather than adding a duplicate field.
  category: z
    .number()
    .int()
    .refine((v) => [3, 4, 5].includes(v), { message: 'Star category must be 3, 4, or 5' })
    .optional(),
  images: z.array(z.string()).optional(),
  description: z.string().optional(),
  // 0070_hotels_status.sql — set explicitly by HotelEditor.jsx/MiceCatalog.jsx's
  // MiceHotelForm on every full Save (status: 'published'), and by
  // HotelEditor.jsx's draft autosave (status: 'draft', only on the create
  // that first materializes the row — the debounced PATCHes after that never
  // resend status, so they can't flip an already-published hotel back to
  // draft mid-edit).
  status: z.enum(['draft', 'published']).optional(),
  // Occupancy-tiered pricing (0061_hotel_occupancy_pricing.sql) — admin
  // checks which of single/double/triple this hotel offers and prices each
  // one independently, replacing the old single flat pricePerNight field in
  // this form. All three optional at the zod level (not a `.refine()`
  // "at least one required" — that would return a ZodEffects, and
  // catalog.routes.js calls `schema.partial()` on this exact schema object
  // for PATCH, which only exists on a plain ZodObject); "at least one
  // occupancy price set" is instead enforced in the Hotel Editor UI itself
  // (HotelEditor.jsx) before it ever submits. pricePerNight itself is no
  // longer collected here — it's derived server-side (toColumns pipeline,
  // catalog.routes.js) so MICE costing, which still reads it, keeps working
  // unchanged.
  singlePrice: z.number().positive('Price must be a positive number').optional(),
  doublePrice: z.number().positive('Price must be a positive number').optional(),
  triplePrice: z.number().positive('Price must be a positive number').optional(),
  boardBasisOptions: z.array(z.string()).optional(),
  miceBallroomCapacity: z.number().int().nonnegative().optional(),
  miceBreakoutRooms: z.number().int().nonnegative().optional(),
  isMiceEnabled: z.boolean().optional(),
});

// name/city/description/duration/images/category/price all used to be
// required unconditionally, same problem hotelSchema had (see its own
// comment above) — 0072_tours_activities_transfers_status.sql moves
// "must be complete" to a publish-time gate instead (requireCatalogPublishFields,
// catalog.routes.js), each field still validating its own format when present.
export const tourSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  city: z.string().min(2).max(100).optional(),
  description: z.string().optional(),
  duration: z.string().max(50).optional(),
  images: z.array(z.string()).optional(),
  category: z.string().max(100).optional(),
  price: z.number().positive('Price must be a positive number').optional(),
  groupSuitability: z.string().optional(),
  suitableAgeMin: z.number().int().nonnegative().optional(),
  isBestseller: z.boolean().optional(),
  isMiceEnabled: z.boolean().optional(),
  // 0072_tours_activities_transfers_status.sql — same status story as
  // hotelSchema's own `status` field above.
  status: z.enum(['draft', 'published']).optional(),
});

export const activitySchema = z.object({
  name: z.string().min(2).max(200).optional(),
  city: z.string().min(2).max(100).optional(),
  description: z.string().optional(),
  duration: z.string().max(50).optional(),
  images: z.array(z.string()).optional(),
  pricePerPax: z.number().nonnegative().optional(),
  suitableAgeMin: z.number().int().nonnegative().optional(),
  isBestseller: z.boolean().optional(),
  isMiceEnabled: z.boolean().optional(),
  status: z.enum(['draft', 'published']).optional(),
});

export const transferSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  type: z.enum(['airport', 'intercity', 'point_to_point', 'group_coach']).optional(),
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
  status: z.enum(['draft', 'published']).optional(),
});

export const experienceSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  images: z.array(z.string()).optional(),
  suitableGroupSizeMin: z.number().int().nonnegative().optional(),
  suitableGroupSizeMax: z.number().int().nonnegative().optional(),
});

// Lunch and Dinner are independent entries — own tab, own save in the admin
// UI — distinguished by mealType (0038_meals_split_type.sql). Price is two
// independent flat rates, not one combined per-pax-per-day figure: a flat
// "for 1 person" charge and a flat "for 1 day" charge, each optional and
// captured on its own (0039_meals_person_day_price.sql).
export const mealSchema = z.object({
  name: z.string().min(2).max(200),
  city: z.string().max(100).optional(),
  description: z.string().optional(),
  mealType: z.enum(['lunch', 'dinner']),
  pricePerPerson: z.number().nonnegative().optional(),
  pricePerDay: z.number().nonnegative().optional(),
});

// Product Catalog "Inclusions & Exclusions" tab (see
// 0049_inclusions_exclusions_catalog.sql) — reusable, name-only phrases the
// admin curates for reference when writing a quotation's client-facing
// Inclusions/Exclusions text. Shared by both the inclusions and exclusions
// catalog entities (catalog.routes.js's ENTITIES) since neither has any
// other field.
export const nameOnlyCatalogSchema = z.object({
  name: z.string().min(1).max(300),
});

// Product Catalog "Visa" tab (see 0051_visa_catalog.sql) — a single
// admin-priced rate per person, no name field (there's only ever the one row).
export const visaSchema = z.object({
  pricePerPerson: z.number().nonnegative(),
});

// Admin "Terms & Conditions" tab (see 0067_site_terms.sql) — a single
// rich-text (TipTap-authored HTML) policy document, singleton like Visa
// above. Not run through toSnakeCaseColumns/CATALOG_KEY_MAP — the
// controller (siteTerms.controller.js) reads bodyHtml straight off the
// validated body, no column-name translation needed for a one-field model.
export const siteTermsSchema = z.object({
  bodyHtml: z.string().min(1, 'Terms & Conditions content is required'),
});

// Product Catalog "Flights" tab (see 0063_flights_catalog.sql) — a plain
// growable list (unlike Visa above), any number of onward and return
// entries. isFlightOnward is set by which of the two Add Flight sub-tab
// forms submitted it (ProductCatalog.jsx's FlightsTab), not admin-picked
// from a dropdown.
export const flightSchema = z.object({
  name: z.string().min(1, 'Flight name is required').max(200),
  source: z.string().min(1, 'Source is required').max(200),
  destination: z.string().min(1, 'Destination is required').max(200),
  departureDate: z.string().min(1, 'Departure date is required'),
  // 0066_flights_departure_time.sql — "HH:MM" from <input type="time">,
  // same required-alongside-the-date posture as departureDate above.
  departureTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Departure time must be a valid HH:MM time'),
  isFlightOnward: z.boolean(),
  // 0065_flights_price.sql — optional, same as transfers.price, so this can
  // still be added without a price and priced in later.
  price: z.number().nonnegative('Price must be a positive number').optional(),
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
  singlePrice: 'single_price',
  doublePrice: 'double_price',
  triplePrice: 'triple_price',
  vehicleClass: 'vehicle_class',
  suitableGroupSizeMin: 'suitable_group_size_min',
  suitableGroupSizeMax: 'suitable_group_size_max',
  mealType: 'meal_type',
  pricePerPerson: 'price_per_person',
  pricePerDay: 'price_per_day',
  departureDate: 'departure_date',
  departureTime: 'departure_time',
  isFlightOnward: 'is_flight_onward',
  // FD packages (fdPackageSchema) — these were missing, which silently dropped
  // them from every create/update since FD_COLUMNS looks up the snake_case key.
  heroImageUrl: 'hero_image_url',
  hotelId: 'hotel_id',
  shortDescription: 'short_description',
  isFeatured: 'is_featured',
  ratePerPax: 'rate_per_pax',
  lunchMealId: 'lunch_meal_id',
  lunchPeople: 'lunch_people',
  lunchDays: 'lunch_days',
  dinnerMealId: 'dinner_meal_id',
  dinnerPeople: 'dinner_people',
  dinnerDays: 'dinner_days',
  visaEnabled: 'visa_enabled',
  flightsEnabled: 'flights_enabled',
  onwardFlightId: 'onward_flight_id',
  returnFlightId: 'return_flight_id',
  flightId: 'flight_id',
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
  heroImageUrl: z.string().nullable().optional(),
  images: z.array(z.string()).optional(),
  hotelId: z.string().uuid().nullable().optional(),
  shortDescription: z.string().optional(),
  suitableAgeMin: z.number().int().nonnegative().optional(),
  isFeatured: z.boolean().optional(),
  isBestseller: z.boolean().optional(),
  status: z.enum(['draft', 'published', 'closed']).optional(),
  // Admin override of the itinerary-computed net rate — null clears the
  // override and falls back to the itinerary total again.
  ratePerPax: z.number().nonnegative().nullable().optional(),
  // Task 4/5 — lunch/dinner are now checkbox-only inclusions: lunchMealId/
  // dinnerMealId non-null *is* "included" (the same one meals-catalog row
  // per meal_type MealsManager already resolved automatically — nothing
  // else to pick), no headcount/day-count collected here anymore. Their
  // actual cost is computed later, at booking time, once a real pax is
  // known (booking.service.js#createFdBooking, utils/meals.js#computeFdMealsPerPax)
  // — a package's own Duration field stands in for "day count". The People/
  // Days columns stay in the schema, still accepted but no longer sent by
  // FdPackageEditor.jsx, purely so any already-saved package data survives
  // being round-tripped through a PATCH untouched.
  lunchMealId: z.string().uuid().nullable().optional(),
  lunchPeople: z.number().int().nonnegative().nullable().optional(),
  lunchDays: z.number().int().nonnegative().nullable().optional(),
  dinnerMealId: z.string().uuid().nullable().optional(),
  dinnerPeople: z.number().int().nonnegative().nullable().optional(),
  dinnerDays: z.number().int().nonnegative().nullable().optional(),
  // Task 5 — Visa is a simple "included or not" checkbox (no catalog
  // picker, there's only ever one Visa product — see 0062_fd_addons_transfer_visa.sql).
  // Priced at booking time from the visa catalog's price_per_person, same
  // deferred-until-real-pax-is-known posture as meals above.
  visaEnabled: z.boolean().optional(),
  // Flights section (0064_fd_package_flights.sql) — flightsEnabled true
  // means this package includes exactly one Onward + one Return flight
  // directly (onwardFlightId/returnFlightId); false means neither is set and
  // those same flights are instead offered as fd_addons checkbox add-ons
  // (see fdAddonSchema's flightId). Enforcing "not both at once" is the
  // editor's job (FdPackageEditor.jsx), not this schema's.
  flightsEnabled: z.boolean().optional(),
  onwardFlightId: z.string().uuid().nullable().optional(),
  returnFlightId: z.string().uuid().nullable().optional(),
  // Client-facing Inclusions/Exclusions — same shape/behavior as Custom FIT
  // quotes (packageRequestCostingSchema above): one point per line, edited
  // in FdPackageEditor.jsx via the catalog dropdown + editable list
  // (admin/components/InclusionExclusionList.jsx).
  inclusions: z.string().max(5000).optional(),
  exclusions: z.string().max(5000).optional(),
});

export const fdDepartureDateSchema = z.object({
  date: z.string(), // ISO date
  seatsTotal: z.number().int().nonnegative(),
  location: z.string().min(1, 'Location is required').max(100), // e.g. "Mumbai" — picked from GET /departure-locations
});

// Task 5 — admin picks a real catalog item (activity/tour/transfer) as a
// paid add-on by checkbox; its price is read straight from that catalog
// entry server-side (fdPackagesAdmin.controller.js#postAddon) rather than
// typed in by hand, so pricePerPax/location (the old manual-entry fields)
// are gone from this schema entirely.
export const fdAddonSchema = z
  .object({
    activityId: z.string().uuid().optional(),
    tourId: z.string().uuid().optional(),
    transferId: z.string().uuid().optional(),
    // Flights section (0064_fd_package_flights.sql) — only ever posted for a
    // package that has flightsEnabled false (the editor hides this option
    // entirely otherwise); nothing enforces that here, same as the rest of
    // the "not both at once" split living in FdPackageEditor.jsx.
    flightId: z.string().uuid().optional(),
  })
  .refine((v) => [v.activityId, v.tourId, v.transferId, v.flightId].filter(Boolean).length === 1, {
    message: 'Provide exactly one of activityId, tourId, transferId, or flightId',
  });

// Reused by both the agent self-service booking schema (below) and the
// Admin Manual Booking flow (Task 13, manualBookingSchema further down) —
// same traveler shape either way: name required, everything else optional
// (passport/DOB are collected later via the separate Documents & Visa flow,
// Screen 23, not at booking time).
const bookingTravelerSchema = z.object({
  name: z.string().min(1),
  passportNo: z.string().optional(),
  dob: z.string().optional(),
  roomShareGroup: z.string().optional(),
});

export const createBookingSchema = z.object({
  departureDateId: z.string().uuid(),
  pax: z.number().int().positive(),
  addonIds: z.array(z.string().uuid()).optional(),
  travelers: z.array(bookingTravelerSchema).optional(),
});

// --- Admin Manual Booking (Task 13 — Screen 22) ---

// FD-only (see booking.service.js/bookingsAdmin.model.js's own comments) —
// `fdPackageId`/`departureDateId` replace the documented `source_selection`,
// and every field name follows this codebase's existing camelCase JSON
// convention rather than the doc's own snake_case route-body shorthand
// (createBookingSchema above, and every other schema in this file, are the
// precedent). `agreedTotalPrice` is MAN-3's "admin enters an agreed sell
// price directly" — required, not derived from the catalog; still just a
// plain validated positive number, same guarantee "never trust a client
// price" gives self-service, just applied to a value that's supposed to
// diverge from the catalog rather than reproduce it.
export const manualBookingSchema = z.object({
  agencyId: z.string().uuid(),
  fdPackageId: z.string().uuid(),
  departureDateId: z.string().uuid(),
  pax: z.number().int().positive(),
  travelers: z.array(bookingTravelerSchema).optional(),
  addonIds: z.array(z.string().uuid()).optional(),
  agreedTotalPrice: z.number().positive(),
  // Offline deposit the admin is recording (money already collected by
  // phone/bank transfer before this screen exists) — never a real
  // Cashfree/NEFT payment record (Task 13 explicitly excludes both), just
  // the amount used to derive the booking's initial status.
  depositPaid: z.number().nonnegative().optional().default(0),
  // Purely descriptive of how that offline deposit was actually collected —
  // not wired to the Cashfree/NEFT/credit-terms pipelines (none of those
  // are admin-initiable here); captured in the booking's audit log entry.
  paymentMethod: z.enum(['cashfree', 'neft', 'credit_terms']).optional(),
});

// --- Client Documents & Visa Processing (Task 14 — Screen 23, DOC-3) ---

// documentRefs identify which already-uploaded documents to attach — either
// a traveler's passport_scan/passport_photo/visa_copy (travelerId required)
// or the booking-level voucher (no travelerId). The controller re-verifies
// each ref actually has an uploaded file before attaching anything — this
// schema only shapes the request, it can't know what's actually on file.
const documentRefSchema = z
  .object({
    type: z.enum(['passport_scan', 'passport_photo', 'visa_copy', 'voucher']),
    travelerId: z.string().uuid().optional(),
  })
  .refine((v) => v.type === 'voucher' || !!v.travelerId, {
    message: 'travelerId is required for traveler-level documents',
    path: ['travelerId'],
  });

export const emailToSupplierSchema = z.object({
  to: z.string().email('Enter a valid supplier email address'),
  message: z.string().max(2000).optional(),
  documentRefs: z.array(documentRefSchema).min(1, 'Select at least one document to send'),
});

// --- Admin Support & Helpdesk (Task 18 — Screen 27/28, SUP-1..3) ---

// SUP-1: "Subject + description form" — both required (see migration
// 0056's own comment on why `description` is required despite the ERD's
// terser one-line listing). `description` is rich text now
// (shared/components/RichTextEditor.jsx on the frontend) — its empty state
// is `<p></p>`, which `.min(1)` alone wouldn't catch, so the refine below
// strips tags first, same as that component's own isEmptyHtml.
export const createTicketSchema = z.object({
  subject: z.string().min(1, 'Subject is required').max(200),
  description: z
    .string()
    .max(5000)
    .refine((v) => v.replace(/<[^>]*>/g, '').trim().length > 0, { message: 'Description is required' }),
  priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
});

// SUP-3 — shared by both the agent's and admin's reply endpoints.
export const ticketMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(5000),
});

// PATCH /admin/support/tickets/:id — "Assign, change status" (doc's own
// route purpose, §12.10). Both optional/independent; at least one must be
// present. assignedToUserId may be explicitly null to unassign. Priority is
// deliberately absent — Task 18 scope: set once at creation, never admin-editable.
export const updateTicketSchema = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved']).optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assignedToUserId !== undefined, {
    message: 'Provide status and/or assignedToUserId',
  });

// --- Agent Review & Rating Popup (Task 20 — Screen 32, REV-1..4) ---

// Rating is required; review text is optional (doc §9.10 step 49: "rates
// and optionally writes a review").
export const submitReviewSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be between 1 and 5').max(5, 'Rating must be between 1 and 5'),
  reviewText: z.string().max(2000).optional(),
});

// --- Admin Reviews Management (Task 21 — Item 33, REV-3) ---
// 'needs_review' is deliberately excluded — it's only ever the submission
// default (reviews.model.js#createReview), never an admin-settable target;
// REV-3 is "publish/hide" only.
export const updateReviewStatusSchema = z.object({
  status: z.enum(['published', 'hidden']),
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
        // Hotel occupancy — two different shapes, only one used per builder
        // (both only meaningful for type: 'hotel'):
        // `adults` — FD Packages only (fd_itinerary_items.adults /
        // computeNetRatePerPax): a direct headcount typed per hotel-day.
        // `occupancy` — Custom FIT only (package_request_itinerary_items.
        // occupancy / roomsForOccupancy): Single/Double/Triple, since
        // headcount is already known from Trip Details (pax_adults).
        // MICE RFQ itineraries ignore both.
        adults: z.number().int().positive().optional(),
        occupancy: z.enum(['single', 'double', 'triple']).optional(),
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
    // Optional lunch/dinner add-on — same shape as FD packages
    // (fdPackageSchema below): a headcount and a day count per meal type,
    // never a specific catalog entry (see computeMealsCost/resolveMealsSummary,
    // src/utils/meals.js). All three null clears that meal type.
    lunchMealId: z.string().uuid().nullable().optional(),
    lunchPeople: z.number().int().nonnegative().nullable().optional(),
    lunchDays: z.number().int().nonnegative().nullable().optional(),
    dinnerMealId: z.string().uuid().nullable().optional(),
    dinnerPeople: z.number().int().nonnegative().nullable().optional(),
    dinnerDays: z.number().int().nonnegative().nullable().optional(),
    // Optional Visa add-on — a checkbox plus an adults-only headcount, no
    // catalog entry to pick (there's only ever the one Visa row, resolved by
    // meal_type-style singleton — see visaModel/visa table). visaPeople is
    // independent of visaEnabled (mirrors lunchMealId/lunchPeople) so
    // toggling off doesn't need to also null this out for visaEnabled to
    // stay the single source of truth for "is Visa included".
    visaEnabled: z.boolean().optional().default(false),
    visaPeople: z.number().int().nonnegative().nullable().optional(),
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
  lunchMealId: z.string().uuid().nullable().optional(),
  lunchPeople: z.number().int().nonnegative().nullable().optional(),
  lunchDays: z.number().int().nonnegative().nullable().optional(),
  dinnerMealId: z.string().uuid().nullable().optional(),
  dinnerPeople: z.number().int().nonnegative().nullable().optional(),
  dinnerDays: z.number().int().nonnegative().nullable().optional(),
  visaEnabled: z.boolean().optional().default(false),
  visaPeople: z.number().int().nonnegative().nullable().optional(),
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
  // Visa add-on (see 0052_package_request_visa.sql) — auto total is
  // visaPeople × the catalog's one price_per_person row, same override
  // convention as every other *Cost field here.
  visaCost: z.number().nonnegative().nullable(),
  markupType: z.enum(['percentage', 'fixed']),
  markupValue: z.number().nonnegative(),
  internalNotes: z.string().max(5000).optional().default(''),
  // Inclusions/Exclusions (see 0048_package_request_inclusions_exclusions.sql)
  // — admin-authored free text set alongside costing, shown read-only on the
  // agent's own quote view once published (packageRequests.controller.js).
  // Unlike internalNotes, these are client-facing, not admin-only.
  inclusions: z.string().max(5000).optional().default(''),
  exclusions: z.string().max(5000).optional().default(''),
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

// --- FD Operations Tracker (Task 12 — Screen 19) ---

// Every stage the generic advance-stage endpoint can set. 'driver_sent' is
// deliberately excluded — it's only ever set automatically as a side effect
// of a real driver dispatch (marketing.controller.js-style single source of
// truth; see fdOperations.model.js#advanceStage's own comment), never via
// this endpoint directly.
const FD_OPERATIONS_STAGES = ['docs_collected', 'supplier_coordination', 'visa_processing', 'trip_live', 'completed'];

export const advanceFdOperationsStageSchema = z.object({
  stage: z.enum(FD_OPERATIONS_STAGES),
});

export const fdOperationsSupplierLogSchema = z.object({
  supplierName: z.string().min(1, 'Supplier name is required').max(200),
  item: z.string().min(1, 'Item is required').max(300),
  status: z.enum(['pending', 'confirmed']).optional().default('pending'),
});

export const fdOperationsDriverDetailsSchema = z.object({
  driverName: z.string().min(1, 'Driver name is required').max(150),
  vehicle: z.string().min(1, 'Vehicle is required').max(150),
  pickupDetails: z.string().min(1, 'Pickup time/point is required').max(500),
});

export const fdOperationsTourUpdateSchema = z.object({
  updateType: z.enum(['itinerary_change', 'delay', 'general_notice']),
  message: z.string().min(1, 'Message is required').max(2000),
});

// Admin Content & CMS Management (Task 21 — Item 34, CMS-1/CMS-2). Matches
// cms_pages (0058_cms.sql) exactly — no SEO/author/tag/ordering/scheduling
// fields, per the doc's own ERD not defining any. `slug` gets a light
// URL-safe format check (lowercase/digits/hyphens) — not itself documented,
// but "slug" has an established, unambiguous technical meaning and this
// merely enforces that shape rather than inventing a new field.
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const cmsPageSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  section: z.string().min(1, 'Section is required').max(150),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(200)
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers, and hyphens only'),
  bodyHtml: z.string().max(200000).optional(),
  status: z.enum(['draft', 'published']).optional().default('draft'),
});

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
