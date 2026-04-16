import { describe, expect, it } from 'vitest';

import type { CheckResult, ScopeCheckResult } from '../src/format-check.ts';
import { formatCheckJson, formatCheckText, severityIndicator } from '../src/format-check.ts';

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

// ---------------------------------------------------------------------------
// severityIndicator
// ---------------------------------------------------------------------------

describe(severityIndicator, () => {
  it.each([
    ['critical', '\u{1F534}'],
    ['high', '\u{1F534}'],
    ['moderate', '\u{1F7E0}'],
    ['low', '\u{1F7E1}'],
    ['info', '\u{1F7E1}'],
  ])('returns correct indicator for %s', (severity, expected) => {
    expect(severityIndicator(severity)).toBe(expected);
  });

  it('returns empty string for undefined severity', () => {
    expect(severityIndicator(undefined)).toBe('');
  });

  it('returns empty string for unknown severity', () => {
    expect(severityIndicator('unknown')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// formatCheckText
// ---------------------------------------------------------------------------

describe(formatCheckText, () => {
  it('shows "(none)" when a scope has no findings', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev']);

    expect(output).toContain('-- \u{1F4E6} prod --');
    expect(output).toContain('  (none)');
    expect(output).toContain('-- \u{1F527} dev --');
  });

  it('separates scope sections with a blank line', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev']);

    // Verify a blank line separates the prod and dev sections.
    const prodIndex = output.indexOf('prod');
    const devIndex = output.indexOf('dev');
    const between = output.slice(prodIndex, devIndex);
    expect(between).toContain('\n\n');
  });

  it('lists unallowed vulnerabilities with severity indicators', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'lodash', severity: 'high', url: 'https://example.com/1' }],
      },
    });

    const output = formatCheckText(result, ['prod']);
    expect(output).toContain('\u{1F534} GHSA-1: lodash (https://example.com/1)');
    expect(output).not.toContain('allowed');
  });

  it('annotates allowed vulnerabilities', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [{ id: 'GHSA-2', path: 'express', severity: 'moderate', url: 'https://example.com/2' }],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['dev']);
    expect(output).toContain('\u{1F7E0} GHSA-2: express (https://example.com/2) \u{1F6AB} allowed');
  });

  it('flags stale entries', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod']);
    expect(output).toContain('GHSA-old \u{1F5D1}\u{FE0F} not needed');
  });

  it('renders mixed findings in a single scope', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-ok', path: 'safe-pkg', severity: 'low', url: 'https://example.com/ok' }],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [{ id: 'GHSA-bad', path: 'bad-pkg', severity: 'critical', url: 'https://example.com/bad' }],
      },
    });

    const output = formatCheckText(result, ['prod']);
    expect(output).toContain('GHSA-bad');
    expect(output).toContain('GHSA-ok');
    expect(output).toContain('GHSA-stale');
  });

  it('renders only requested scopes', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-dev', path: 'pkg', url: 'https://example.com/dev' }],
      },
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-prod', path: 'pkg', url: 'https://example.com/prod' }],
      },
    });

    const output = formatCheckText(result, ['prod']);
    expect(output).toContain('GHSA-prod');
    expect(output).not.toContain('GHSA-dev');
  });

  it('omits severity prefix when severity is undefined', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', path: 'pkg', url: 'https://example.com/1' }],
      },
    });

    const output = formatCheckText(result, ['prod']);
    expect(output).toContain('  GHSA-1: pkg (https://example.com/1)');
  });
});

// ---------------------------------------------------------------------------
// formatCheckJson
// ---------------------------------------------------------------------------

describe(formatCheckJson, () => {
  it('produces parseable JSON with requested scopes', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', severity: 'high', url: 'https://example.com/1' }],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });

    const parsed: unknown = JSON.parse(formatCheckJson(result, ['prod']));
    expect(parsed).toEqual({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', severity: 'high', url: 'https://example.com/1' }],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });
  });

  it('includes only requested scopes', () => {
    const result = makeCheckResult();
    const parsed: unknown = JSON.parse(formatCheckJson(result, ['dev']));
    expect(parsed).toHaveProperty('dev');
    expect(parsed).not.toHaveProperty('prod');
  });
});
