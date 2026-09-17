function isValidTimeZone(timeZone) {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

module.exports.isValidTimeZone = isValidTimeZone;

function zonedDateTimeToUtc(dateStr, timeStr, timeZone) {
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

module.exports.zonedDateTimeToUtc = zonedDateTimeToUtc;
