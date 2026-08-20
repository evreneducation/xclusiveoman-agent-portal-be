// Access Features — the admin-set checkboxes (Employees & Roles create/manage
// forms, admin/pages/Employees.jsx) that decide two things for a Lead
// Manager (`sales_manager`) or Relationship Manager (`relationship_manager`)
// staff account: which /team sidebar sections they see (frontend, cosmetic),
// and which admin API routes they're actually allowed to call
// (middleware/auth.js#requireFeature, the real enforcement — same
// "frontend nav is UX only, the backend gate is what's real" split this
// codebase already uses for SuperAdminRoute.jsx/requireRole('super_admin')).
//
// Stored as one flat boolean map on users.permissions (JSONB, already
// existed for agency sub-users — agencies.controller.js#createSubUser).
// LM and RM each have their own fixed key set — deliberately NOT a single
// shared set, since the two roles' jobs don't overlap (REL-1/REL-2 vs.
// FIT-8/REL-3, doc §4's role table).

export const LM_FEATURE_KEYS = ['catalog', 'quotesPricing', 'bookingsDocs', 'fdOperations'];
export const RM_FEATURE_KEYS = ['approvedAgents', 'quotesPricing', 'supportTickets', 'bookingsDocs'];

// What a brand-new LM/RM starts with when an admin doesn't pass `permissions`
// at all on create — a sensible non-empty default rather than every checkbox
// starting unchecked. Admin can change any of these on the create form (or
// later, on the Manage panel) before/after saving either way.
export const LM_DEFAULT_PERMISSIONS = {
  catalog: true,
  quotesPricing: true,
  bookingsDocs: false,
  fdOperations: false,
};

export const RM_DEFAULT_PERMISSIONS = {
  approvedAgents: true,
  quotesPricing: false,
  supportTickets: false,
  bookingsDocs: false,
};

function normalize(keys, defaults, input) {
  const source = input && typeof input === 'object' ? input : defaults;
  const out = {};
  for (const key of keys) {
    out[key] = source[key] === undefined ? defaults[key] : Boolean(source[key]);
  }
  return out;
}

// `input` is whatever the request body's `permissions` field was (undefined
// on a plain create with no explicit choices, or the full checkbox set the
// Employees.jsx form always submits) — any key outside LM/RM_FEATURE_KEYS is
// silently dropped, and any missing key falls back to that role's default,
// so the stored users.permissions row is always exactly this fixed shape.
export function normalizeLmPermissions(input) {
  return normalize(LM_FEATURE_KEYS, LM_DEFAULT_PERMISSIONS, input);
}

export function normalizeRmPermissions(input) {
  return normalize(RM_FEATURE_KEYS, RM_DEFAULT_PERMISSIONS, input);
}
