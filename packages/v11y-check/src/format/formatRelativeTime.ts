/**
 * Produces a human-readable relative-time string such as "just now", "N minutes ago",
 * "yesterday", "N months ago", "N years ago".
 *
 * Uses millisecond math for units up through weeks to avoid DST/timezone drift on
 * short intervals, and UTC calendar math for months and years.
 */
export function formatRelativeTime(fromIso: string, now: Date): string {
  const fromDate = parseDateUtc(fromIso);
  if (fromDate === undefined) return '';

  const deltaMs = now.getTime() - fromDate.getTime();
  if (deltaMs < 60_000) return 'just now';

  const elapsedMinutes = Math.floor(deltaMs / 60_000);
  if (elapsedMinutes < 60) return pluralize(elapsedMinutes, 'minute');

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return pluralize(elapsedHours, 'hour');

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return 'yesterday';
  if (elapsedDays < 7) return pluralize(elapsedDays, 'day');

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 5) return pluralize(elapsedWeeks, 'week');

  const elapsedMonths = diffMonthsUtc(fromDate, now);
  if (elapsedMonths < 12) return pluralize(elapsedMonths, 'month');

  const elapsedYears = Math.floor(elapsedMonths / 12);
  return pluralize(elapsedYears, 'year');
}

/** Parses a YYYY-MM-DD (or full ISO) string into a UTC Date; returns undefined if invalid. */
function parseDateUtc(iso: string): Date | undefined {
  // ECMAScript parses date-only ISO strings (YYYY-MM-DD) and full ISO strings as UTC.
  const parsedDate = new Date(iso);
  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
}

/** Computes the number of whole months between two dates in UTC. */
function diffMonthsUtc(fromDate: Date, now: Date): number {
  let elapsedMonths =
    (now.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 + (now.getUTCMonth() - fromDate.getUTCMonth());
  if (now.getUTCDate() < fromDate.getUTCDate()) {
    elapsedMonths -= 1;
  }
  return Math.max(0, elapsedMonths);
}

/** Formats an integer count + unit, pluralizing with a simple `s`. */
function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
