const LM_FEATURE_KEYS = ['catalog', 'quotesPricing', 'bookingsDocs', 'fdOperations'];
module.exports.LM_FEATURE_KEYS = LM_FEATURE_KEYS;
const RM_FEATURE_KEYS = ['approvedAgents', 'quotesPricing', 'supportTickets', 'bookingsDocs'];
module.exports.RM_FEATURE_KEYS = RM_FEATURE_KEYS;

const LM_DEFAULT_PERMISSIONS = {
  catalog: true,
  quotesPricing: true,
  bookingsDocs: false,
  fdOperations: false,
};

module.exports.LM_DEFAULT_PERMISSIONS = LM_DEFAULT_PERMISSIONS;

const RM_DEFAULT_PERMISSIONS = {
  approvedAgents: true,
  quotesPricing: false,
  supportTickets: false,
  bookingsDocs: false,
};

module.exports.RM_DEFAULT_PERMISSIONS = RM_DEFAULT_PERMISSIONS;

function normalize(keys, defaults, input) {
  const source = input && typeof input === 'object' ? input : defaults;
  const out = {};
  for (const key of keys) {
    out[key] = source[key] === undefined ? defaults[key] : Boolean(source[key]);
  }
  return out;
}

function normalizeLmPermissions(input) {
  return normalize(LM_FEATURE_KEYS, LM_DEFAULT_PERMISSIONS, input);
}

module.exports.normalizeLmPermissions = normalizeLmPermissions;

function normalizeRmPermissions(input) {
  return normalize(RM_FEATURE_KEYS, RM_DEFAULT_PERMISSIONS, input);
}

module.exports.normalizeRmPermissions = normalizeRmPermissions;
