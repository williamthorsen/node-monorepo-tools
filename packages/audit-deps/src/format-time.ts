/**
 * Produce a human-readable relative-time string such as "just now", "N minutes ago",
 * "yesterday", "N months ago", "N years ago".
 *
 * Uses millisecond math for units up through weeks to avoid DST/timezone drift on
 * short intervals, and UTC calendar math for months and years.
 *
 * @internal — exported for test access; consumers should use higher-level formatting helpers.
 */
export function formatRelativeTime(fromIso: string, now: Date): string {
  const from = parseDateUtc(fromIso);
  if (from === undefined) return '';

  const deltaMs = now.getTime() - from.getTime();
  if (deltaMs < 60_000) return 'just now';

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return pluralize(minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return pluralize(hours, 'hour');

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return pluralize(days, 'day');

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return pluralize(weeks, 'week');

  const months = diffMonthsUtc(from, now);
  if (months < 12) return pluralize(months, 'month');

  const years = Math.floor(months / 12);
  return pluralize(years, 'year');
}

/** Parse a YYYY-MM-DD (or full ISO) string into a UTC Date; return undefined if invalid. */
function parseDateUtc(iso: string): Date | undefined {
  // ECMAScript parses date-only ISO strings (YYYY-MM-DD) and full ISO strings as UTC.
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Compute the number of whole months between two dates in UTC. */
function diffMonthsUtc(from: Date, now: Date): number {
  let months = (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + (now.getUTCMonth() - from.getUTCMonth());
  if (now.getUTCDate() < from.getUTCDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

/** Format an integer count + unit, pluralizing with a simple `s`. */
function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
