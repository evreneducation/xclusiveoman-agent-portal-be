// Marketing Center Task 6 — Schedule Campaign. No timezone library exists
// anywhere in this backend (no luxon/moment/date-fns-tz) and every existing
// timestamp column is TIMESTAMPTZ (Postgres' standard UTC-internal
// storage) — this follows that same convention using only Node's built-in
// `Intl` API rather than adding a new dependency.
//
// This is the one place the admin's chosen wall-clock date/time/IANA-zone
// gets converted to a real UTC instant — both the "must be in the future"
// validation (validation/schemas.js) and the actual `scheduled_at` storage
// (marketing.controller.js#scheduleCampaign) call this, so they can never
// disagree about what a schedule request actually means.

// `Intl.DateTimeFormat` throws on an unrecognised zone name — the cheapest
// way to validate an IANA timezone string without a lookup table of our own.
export function isValidTimeZone(timeZone) {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Converts a wall-clock "YYYY-MM-DD" + "HH:mm" in `timeZone` to the
// corresponding UTC Date. `Intl` has no direct "zoned time -> UTC"
// conversion, so this uses the standard trick: parse the wall-clock digits
// as if they were already UTC, ask `Intl.DateTimeFormat` what that instant
// actually reads as *in the target zone*, and correct by the difference —
// which is exactly the zone's UTC offset (DST included) at that instant.
// Returns null on malformed input or an unrecognised zone, rather than
// throwing — callers (a zod refine, and the controller) both treat null as
// "invalid".
export function zonedDateTimeToUtc(dateStr, timeStr, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr || '');
  if (!dateMatch || !timeMatch || !isValidTimeZone(timeZone)) return null;

  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(naiveUtcMs));
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  const asZonedMs = Date.UTC(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second)
  );
  const offsetMs = asZonedMs - naiveUtcMs;
  return new Date(naiveUtcMs - offsetMs);
}
