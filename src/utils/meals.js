// Meals add-on cost for the Custom FIT Package Builder
// (packageRequestsAdmin.controller.js): a flat add-on total (headcount ×
// days), not one line per itinerary day. `row` carries
// {prefix}_meal_id/{prefix}_people/{prefix}_days columns (package_requests);
// `meals` is the meals catalog list. A meal type only contributes once a
// specific catalog entry, a headcount, and a day count are all set. The
// catalog captures a "price for 1 day" per meal_type, treated as the
// per-person-per-day rate. (FD Packages no longer use this — meals there are
// opt-in fd_addons rows, priced price_per_day × Duration; see 0075.)
function mealTypeCost(row, meals, prefix) {
  const mealId = row[`${prefix}_meal_id`];
  const people = row[`${prefix}_people`];
  const days = row[`${prefix}_days`];
  if (!mealId || !people || !days) return 0;
  const meal = (meals || []).find((m) => m.id === mealId);
  return meal ? Number(meal.price_per_day || 0) * Number(people) * Number(days) : 0;
}

export function computeMealsCost(row, meals) {
  return mealTypeCost(row, meals, 'lunch') + mealTypeCost(row, meals, 'dinner');
}

// Days from a package's free-text Duration field ("7 Days", "5", …). Still
// used for FD meal add-on pricing (fdPackages.model.js#repriceMealAddons /
// fdPackagesAdmin.controller.js#resolveAddonPriceAndName — price_per_day ×
// this) and elsewhere. Mirrors the frontend's own parseDurationDays
// (shared/fdPackage/index.js) exactly.
export function parseDurationDays(duration) {
  if (!duration) return null;
  const match = String(duration).match(/(\d+)\s*d(?:ay)?s?\b/i);
  const days = Number(match ? match[1] : duration);
  return Number.isFinite(days) && days > 0 ? days : null;
}
