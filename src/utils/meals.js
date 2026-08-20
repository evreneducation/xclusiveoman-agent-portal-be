// Meals add-on cost, shared by FD Packages (fdPackages.model.js) and the
// Custom FIT Package Builder (packageRequestsAdmin.controller.js) — both
// price lunch/dinner the same way: a flat add-on total (headcount × days),
// not one line per itinerary day. `row` is any row carrying
// {prefix}_meal_id/{prefix}_people/{prefix}_days columns (fd_packages or
// package_requests); `meals` is the meals catalog list. A meal type only
// contributes once a specific catalog entry, a headcount, and a day count
// are all set. The catalog only captures a "price for 1 day" per meal_type
// (not a separate price-per-person), treated as the per-person-per-day rate.
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

// Per-meal-type breakdown (people/days/rate/cost) for read-only display.
// Only includes a type once a catalog entry, headcount, and day count are
// all set (same gate as mealTypeCost), and skips it if the catalog entry has
// since been removed.
function resolveMealTypeSummary(row, meals, prefix, label) {
  const mealId = row[`${prefix}_meal_id`];
  const people = row[`${prefix}_people`];
  const days = row[`${prefix}_days`];
  if (!mealId || !people || !days) return null;
  const meal = (meals || []).find((m) => m.id === mealId);
  if (!meal) return null;
  const pricePerDay = Number(meal.price_per_day || 0);
  return { type: prefix, label, people: Number(people), days: Number(days), pricePerDay, cost: pricePerDay * Number(people) * Number(days) };
}

export function resolveMealsSummary(row, meals) {
  return [
    resolveMealTypeSummary(row, meals, 'lunch', 'Lunch'),
    resolveMealTypeSummary(row, meals, 'dinner', 'Dinner'),
  ].filter(Boolean);
}

// FD Packages only (Task 5) — dayCount for meal/visa pricing at booking
// time comes from the package's own Duration field (FdPackageEditor.jsx's
// Basics form, a plain number-of-days input), not an admin-typed people/day
// count the way computeMealsCost above still works for Custom FIT. Mirrors
// the frontend's own parseDurationDays (shared/fdPackage/index.js) exactly,
// so the two never disagree about what a given Duration string means.
export function parseDurationDays(duration) {
  if (!duration) return null;
  const match = String(duration).match(/(\d+)\s*d(?:ay)?s?\b/i);
  const days = Number(match ? match[1] : duration);
  return Number.isFinite(days) && days > 0 ? days : null;
}

// FD Packages' own meal pricing (Task 4/5) — no admin-entered headcount or
// day count anymore (unlike computeMealsCost above, still used by Custom
// FIT's own lunch_people/lunch_days): a meal type is simply included or not
// (fd_packages.lunch_meal_id/dinner_meal_id non-null — the same "included"
// signal MealsManager's checkbox already set, no new column needed),
// priced at price_per_day × the package's own Duration in days. Multiplied
// by the agent's real pax only once a booking is actually made
// (booking.service.js#createFdBooking) — headcount is never known before
// that, so this can only ever return a *per-pax* figure, not a total.
function fdMealTypePerPax(row, meals, prefix, dayCount) {
  const mealId = row[`${prefix}_meal_id`];
  if (!mealId || !dayCount) return 0;
  const meal = (meals || []).find((m) => m.id === mealId);
  return meal ? Number(meal.price_per_day || 0) * dayCount : 0;
}

export function computeFdMealsPerPax(fdPackage, meals, dayCount) {
  return fdMealTypePerPax(fdPackage, meals, 'lunch', dayCount) + fdMealTypePerPax(fdPackage, meals, 'dinner', dayCount);
}
