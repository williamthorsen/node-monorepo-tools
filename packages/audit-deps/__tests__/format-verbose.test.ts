import { describe, expect, it } from 'vitest';

import type { CheckResult, ScopeCheckResult } from '../src/format-check.ts';
import { formatCheckVerboseText, formatRelativeTime } from '../src/format-verbose.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyScopeResult(): ScopeCheckResult {
  return { allowed: [], stale: [], unallowed: [] };
}

function makeCheckResult(overrides?: Partial<CheckResult>): CheckResult {
  return {
    dev: emptyScopeResult(),
    prod: emptyScopeResult(),
    ...overrides,
  };
}

const FIXED_NOW = new Date('2026-04-15T00:00:00Z');

// ---------------------------------------------------------------------------
// formatCheckVerboseText: unallowed entries
// ---------------------------------------------------------------------------

describe(formatCheckVerboseText, () => {
  it('renders "(none)" for an empty scope', () => {
    const result = makeCheckResult();
    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('-- \u{1F4E6} prod --');
    expect(output).toContain('  (none)');
  });

  it('renders an unallowed vulnerability with 🚨 marker, title, path, and link', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-unallowed',
            path: 'lodash',
            paths: ['my-app>lodash'],
            severity: 'high',
            title: 'Prototype pollution in lodash',
            url: 'https://github.com/advisories/GHSA-unallowed',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('\u{1F6A8} GHSA-unallowed');
    expect(output).toContain('\u{1F534} high');
    expect(output).toContain('Prototype pollution in lodash');
    expect(output).toContain('path: my-app>lodash');
    expect(output).toContain('link: https://github.com/advisories/GHSA-unallowed');
  });

  it('renders multi-path vulnerabilities with a plural "paths:" list', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-multi',
            path: 'lodash',
            paths: ['app>some-lib>lodash', 'app>other-lib>lodash'],
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-multi',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('paths:');
    expect(output).toContain('- app>some-lib>lodash');
    expect(output).toContain('- app>other-lib>lodash');
    expect(output).not.toMatch(/\bpath: /);
  });

  it('renders single-path vulnerabilities with a singular "path:" line', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-single',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/single',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('path: pkg');
    expect(output).not.toMatch(/paths:\s*\n/);
  });

  it('word-wraps description indented to the detail column', () => {
    const longDescription =
      'Merging user-controlled objects into a plain object can lead to prototype pollution, enabling attackers to modify Object.prototype.';
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            description: longDescription,
            id: 'GHSA-wrap',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/wrap',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('     Merging');
    // No single line should contain the whole description.
    const lines = output.split('\n');
    const veryLongLine = lines.find((line) => line.length > 90);
    expect(veryLongLine).toBeUndefined();
  });

  it('preserves paragraph breaks in description', () => {
    const description = 'First paragraph.\n\nSecond paragraph.';
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            description,
            id: 'GHSA-paras',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/paras',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('First paragraph.');
    expect(output).toContain('Second paragraph.');
    // Expect a blank line between the two paragraphs.
    const firstIdx = output.indexOf('First paragraph.');
    const secondIdx = output.indexOf('Second paragraph.');
    const between = output.slice(firstIdx, secondIdx);
    expect(between).toContain('\n\n');
  });

  it('omits description block when description is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-nodesc',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/nodesc',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    // Link is the last content line, followed by scope newline, not a description.
    expect(output).toContain('link: https://example.com/nodesc');
  });

  // --------------------
  // Allowed entries
  // --------------------

  it('renders an allowed entry with ⚠️ marker and "allowed X ago (YYYY-MM-DD)"', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: '2026-04-01',
            id: 'GHSA-allowed',
            path: 'pkg',
            paths: ['pkg'],
            reason: 'Accepted risk: no user input reaches this path',
            severity: 'moderate',
            title: 'Regex denial of service',
            url: 'https://example.com/allowed',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('\u{26A0}\u{FE0F} GHSA-allowed');
    expect(output).toContain('allowed 2 weeks ago (2026-04-01)');
    expect(output).toContain('reason: Accepted risk: no user input reaches this path');
    expect(output).toContain('Regex denial of service');
    expect(output).toContain('\u{1F7E0} moderate');
  });

  it('omits "allowed X ago" line when addedAt is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            id: 'GHSA-noAddedAt',
            path: 'pkg',
            paths: ['pkg'],
            reason: 'legacy',
            url: 'https://example.com/noAddedAt',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('GHSA-noAddedAt');
    expect(output).not.toContain('allowed ');
  });

  it('omits the relative-time portion when addedAt is unparseable', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: 'not-a-date',
            id: 'GHSA-badDate',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/badDate',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('allowed (not-a-date)');
    expect(output).not.toContain('allowed  (not-a-date)');
  });

  it('omits "reason:" line when reason is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: '2026-04-01',
            id: 'GHSA-noReason',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/noReason',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).not.toContain('reason:');
  });

  // --------------------
  // Stale entries
  // --------------------

  it('renders stale entries as a single "🗑️ <id>  not needed" line', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [{ id: 'GHSA-stale-entry-0000' }],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('  \u{1F5D1}\u{FE0F} GHSA-stale-entry-0000  not needed');
  });

  it('appends an Actions footer when unallowed or stale entries exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [
          {
            id: 'GHSA-bad',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/bad',
          },
        ],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('add vulnerabilities to the allowlist and remove stale entries');
  });

  it('omits the Actions footer when the allowlist is fully current', () => {
    const output = formatCheckVerboseText(makeCheckResult(), ['prod', 'dev'], FIXED_NOW);
    expect(output).not.toContain('Actions:');
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

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

  it('returns empty string for an unparseable date', () => {
    expect(formatRelativeTime('not-a-date', nowDate)).toBe('');
  });
});
