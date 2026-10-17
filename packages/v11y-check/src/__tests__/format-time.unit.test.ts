import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from '../format-time.ts';

describe(formatRelativeTime, () => {
  const nowDate = new Date('2026-04-15T12:00:00Z');

  it('returns "just now" when the interval is under a minute', () => {
    const thirtySecondsAgo = new Date('2026-04-15T11:59:30Z');
    expect(formatRelativeTime(thirtySecondsAgo.toISOString(), nowDate)).toBe('just now');
  });

  it('returns "N minutes ago" for sub-hour intervals', () => {
    const tenMinutesAgo = new Date('2026-04-15T11:50:00Z');
    expect(formatRelativeTime(tenMinutesAgo.toISOString(), nowDate)).toBe('10 minutes ago');
  });

  it('uses "1 minute ago" singular', () => {
    const oneMinuteAgo = new Date('2026-04-15T11:59:00Z');
    expect(formatRelativeTime(oneMinuteAgo.toISOString(), nowDate)).toBe('1 minute ago');
  });

  it('returns "N hours ago" for sub-day intervals', () => {
    const fiveHoursAgo = new Date('2026-04-15T07:00:00Z');
    expect(formatRelativeTime(fiveHoursAgo.toISOString(), nowDate)).toBe('5 hours ago');
  });

  it('uses "1 hour ago" singular', () => {
    const oneHourAgo = new Date('2026-04-15T11:00:00Z');
    expect(formatRelativeTime(oneHourAgo.toISOString(), nowDate)).toBe('1 hour ago');
  });

  it('returns "yesterday" for exactly one day ago', () => {
    const yesterday = new Date('2026-04-14T12:00:00Z');
    expect(formatRelativeTime(yesterday.toISOString(), nowDate)).toBe('yesterday');
  });

  it('returns "N days ago" for intervals between 2 and 6 days', () => {
    const threeDaysAgo = new Date('2026-04-12T12:00:00Z');
    expect(formatRelativeTime(threeDaysAgo.toISOString(), nowDate)).toBe('3 days ago');
  });

  it('returns "N weeks ago" for intervals of 1 to 4 weeks', () => {
    expect(formatRelativeTime('2026-04-01', nowDate)).toBe('2 weeks ago');
  });

  it('returns "N months ago" for intervals spanning several months', () => {
    expect(formatRelativeTime('2026-01-15', nowDate)).toBe('3 months ago');
  });

  it('returns "N years ago" for intervals of a year or more', () => {
    expect(formatRelativeTime('2024-04-15', nowDate)).toBe('2 years ago');
  });

  it('uses "1 year ago" singular at exactly 12 months on the same calendar day', () => {
    expect(formatRelativeTime('2025-04-15', nowDate)).toBe('1 year ago');
  });

  it('handles month-boundary edge cases (earlier day-of-month in the source)', () => {
    // From Mar 20 to Apr 15 is 26 days → under a month (under 5 weeks renders as 3 weeks ago).
    expect(formatRelativeTime('2026-03-20', nowDate)).toBe('3 weeks ago');
  });

  it('crosses the 5-week boundary into months at exactly 35 days', () => {
    // From Mar 11 to Apr 15 is 35 days → 5 weeks, which the formatter reports as 1 month ago
    // (>= 5 weeks switches to UTC calendar-month math, which yields 1 for this pair).
    expect(formatRelativeTime('2026-03-11', nowDate)).toBe('1 month ago');
  });

  it('returns empty string for an unparseable date', () => {
    expect(formatRelativeTime('not-a-date', nowDate)).toBe('');
  });
});
