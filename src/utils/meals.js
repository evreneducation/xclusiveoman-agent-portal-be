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
