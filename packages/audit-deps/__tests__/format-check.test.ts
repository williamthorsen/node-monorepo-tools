import { describe, expect, it } from 'vitest';

import type { CheckResult, ScopeCheckResult } from '../src/format-check.ts';
import { formatCheckJson, formatCheckText, severityIndicator } from '../src/format-check.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-04-15T00:00:00Z');

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
  // --- All clean ---

  it('prints "No known vulnerabilities found." when both scopes are clean', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev'], FIXED_NOW);

    expect(output).toContain('\u{1F52C} Auditing dependencies ...');
    expect(output).toContain('No known vulnerabilities found.');
    expect(output).not.toContain('\u{1F4E6}');
    expect(output).not.toContain('\u{1F527}');
  });

  it('prints "No known vulnerabilities found." when a single clean scope is audited', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod'], FIXED_NOW);

    expect(output).toContain('\u{1F52C} Auditing prod dependencies ...');
    expect(output).toContain('No known vulnerabilities found.');
  });

  // --- Intro banner ---

  it('includes "dev" in the intro banner when only dev is audited', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['dev'], FIXED_NOW);
    expect(output).toContain('\u{1F52C} Auditing dev dependencies ...');
  });

  it('omits scope name from intro banner when both scopes are audited', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev'], FIXED_NOW);
    expect(output).toContain('\u{1F52C} Auditing dependencies ...');
  });

  // --- Multi-scope with findings ---

  it('shows scope headers when multiple scopes are audited and at least one has findings', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-1',
            ghsaId: 'GHSA-1',
            path: 'lodash',
            paths: ['lodash'],
            severity: 'high',
            url: 'https://example.com/1',
          },
        ],
      },
    });

    const output = formatCheckText(result, ['prod', 'dev'], FIXED_NOW);
    expect(output).toContain('  \u{1F4E6} prod:');
    expect(output).toContain('  \u{1F527} dev:');
  });

  it('shows "No known vulnerabilities found." for a clean scope when another has findings', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            id: '1234',
            ghsaId: 'GHSA-dev1',
            path: 'pkg',
            paths: ['pkg'],
            severity: 'moderate',
            url: 'https://example.com/dev',
          },
        ],
      },
    });

    const output = formatCheckText(result, ['prod', 'dev'], FIXED_NOW);
    expect(output).toContain('  \u{1F4E6} prod:');
    expect(output).toContain('  No known vulnerabilities found.');
    expect(output).toContain('  \u{1F527} dev:');
    expect(output).toContain('GHSA-dev1');
  });

  // --- Unallowed vulnerabilities ---

  it('lists unallowed vulnerabilities with GHSA ID and severity suffix', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [
          {
            id: '1234',
            ghsaId: 'GHSA-abcd-efgh-1234',
            path: '.>path>to>dep',
            paths: ['.>path>to>dep'],
            severity: 'critical',
            url: 'https://example.com/1',
          },
        ],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('  \u{2022} \u{1F6A8} GHSA-abcd-efgh-1234: .>path>to>dep  \u{1F534} critical');
  });

  it('falls back to numeric ID when ghsaId is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: '1234', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('\u{1F6A8} 1234: pkg');
  });

  it('omits severity suffix when severity is undefined', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', ghsaId: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('  \u{2022} \u{1F6A8} GHSA-1: pkg');
    expect(output).not.toContain('\u{1F534}');
    expect(output).not.toContain('\u{1F7E0}');
  });

  // --- Allowed vulnerabilities ---

  it('annotates allowed vulnerabilities with relative time and addedAt', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [
          {
            addedAt: '2026-04-01T00:00:00.000Z',
            ghsaId: 'GHSA-allowed',
            id: '1234',
            path: 'express',
            paths: ['express'],
            severity: 'moderate',
            url: 'https://example.com/2',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['dev'], FIXED_NOW);
    expect(output).toContain('\u{26A0}\u{FE0F} GHSA-allowed: express  \u{1F7E0} moderate');
    expect(output).toContain('\u{2705} allowed since 2 weeks ago (2026-04-01T00:00:00.000Z)');
  });

  it('omits "allowed since" suffix when addedAt is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: '1234', ghsaId: 'GHSA-nodate', path: 'pkg', paths: ['pkg'], url: 'https://example.com' }],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('GHSA-nodate');
    expect(output).not.toContain('allowed');
  });

  // --- Stale entries ---

  it('renders stale entries with bullet format', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('  \u{2022} \u{1F5D1}\u{FE0F} GHSA-old \u{2022} not needed');
  });

  // --- Mixed findings ---

  it('renders mixed findings in a single scope', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: '2026-04-01',
            id: 'ok',
            ghsaId: 'GHSA-ok',
            path: 'safe-pkg',
            paths: ['safe-pkg'],
            severity: 'low',
            url: 'https://example.com/ok',
          },
        ],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [
          {
            id: 'bad',
            ghsaId: 'GHSA-bad',
            path: 'bad-pkg',
            paths: ['bad-pkg'],
            severity: 'critical',
            url: 'https://example.com/bad',
          },
        ],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('GHSA-bad');
    expect(output).toContain('GHSA-ok');
    expect(output).toContain('GHSA-stale');
  });

  it('renders only requested scopes', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'dev1', ghsaId: 'GHSA-dev', path: 'pkg', paths: ['pkg'], url: 'https://example.com/dev' }],
      },
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'prod1', ghsaId: 'GHSA-prod', path: 'pkg', paths: ['pkg'], url: 'https://example.com/prod' }],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('GHSA-prod');
    expect(output).not.toContain('GHSA-dev');
  });

  // --- Actions footer ---

  it('appends an Actions footer with verbose and sync hints when unallowed vulnerabilities exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [],
        unallowed: [{ id: 'GHSA-bad', path: 'pkg', paths: ['pkg'], url: 'https://example.com/bad' }],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('Run `audit-deps --prod --verbose` for full report');
    expect(output).toContain('Run `audit-deps sync` to add vulnerabilities to the allowlist.');
  });

  it('appends an Actions footer with the remove-only hint when only stale entries exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('Run `audit-deps sync` to remove stale allowlist entries.');
    // No verbose hint for stale-only
    expect(output).not.toContain('--verbose');
  });

  it('appends an Actions footer combining both hints when unallowed and stale both exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [{ id: 'GHSA-bad', path: 'pkg', paths: ['pkg'], url: 'https://example.com/bad' }],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('add vulnerabilities to the allowlist and remove stale entries');
  });

  it('omits the Actions footer when the allowlist is fully current', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev'], FIXED_NOW);
    expect(output).not.toContain('Actions:');
  });

  it('shows verbose hint when only allowed vulns exist (no unallowed, no stale)', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          { id: '1', ghsaId: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/1' },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], FIXED_NOW);
    expect(output).toContain('Run `audit-deps --prod --verbose` for full report');
    // No sync hint since nothing to sync
    expect(output).not.toContain('audit-deps sync');
  });
});

// ---------------------------------------------------------------------------
// formatCheckJson
// ---------------------------------------------------------------------------

describe(formatCheckJson, () => {
  it('produces parseable JSON with requested scopes', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });

    const parsed: unknown = JSON.parse(formatCheckJson(result, ['prod']));
    expect(parsed).toStrictEqual({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });
  });

  it('includes new advisory fields and allowlist fields on allowed entries in JSON', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: '2026-04-01T00:00:00.000Z',
            cvss: { score: 7.5 },
            description: 'Detailed description',
            id: 'GHSA-allowed',
            path: 'pkg',
            paths: ['pkg', 'other-pkg>pkg'],
            reason: 'Accepted risk',
            severity: 'high',
            title: 'Prototype pollution',
            url: 'https://example.com/allowed',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const parsed: unknown = JSON.parse(formatCheckJson(result, ['prod']));
    expect(parsed).toStrictEqual(
      expect.objectContaining({
        prod: expect.objectContaining({
          allowed: [
            expect.objectContaining({
              addedAt: '2026-04-01T00:00:00.000Z',
              cvss: { score: 7.5 },
              description: 'Detailed description',
              paths: ['pkg', 'other-pkg>pkg'],
              reason: 'Accepted risk',
              title: 'Prototype pollution',
            }),
          ],
        }),
      }),
    );
  });

  it('includes only requested scopes', () => {
    const result = makeCheckResult();
    const parsed: unknown = JSON.parse(formatCheckJson(result, ['dev']));
    expect(parsed).toHaveProperty('dev');
    expect(parsed).not.toHaveProperty('prod');
  });
});
