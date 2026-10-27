import { describe, expect, it } from 'vitest';

import { formatCheckText, getSeverityIndicator } from '../format-check.ts';
import { buildPopulatedCheckResult } from '../test-utils/buildPopulatedCheckResult.ts';
import { makeCheckResult } from '../test-utils/check-result-fixtures.ts';

const FIXED_NOW = new Date('2026-04-15T00:00:00Z');

// -- getSeverityIndicator --

describe(getSeverityIndicator, () => {
  it.each(['critical', 'high', 'moderate', 'low', 'info'])(
    'returns an empty string for %s in plain style',
    (severity) => {
      expect(getSeverityIndicator(severity, 'plain')).toBe('');
    },
  );

  it.each([
    ['critical', '\u{1F534}'],
    ['high', '\u{1F534}'],
    ['moderate', '\u{1F7E0}'],
    ['low', '\u{1F7E1}'],
    ['info', '\u{1F7E1}'],
  ])('returns correct indicator for %s', (severity, expected) => {
    expect(getSeverityIndicator(severity, 'rich')).toBe(expected);
  });

  it('returns empty string for undefined severity', () => {
    expect(getSeverityIndicator(undefined, 'rich')).toBe('');
  });

  it('returns empty string for unknown severity', () => {
    expect(getSeverityIndicator('unknown', 'rich')).toBe('');
  });
});

// -- formatCheckText --

describe(formatCheckText, () => {
  // -- All clean --

  it('prints "No known vulnerabilities found." when both scopes are clean', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);

    expect(output).toContain('\u{1F52C} Auditing dependencies ...');
    expect(output).toContain('No known vulnerabilities found.');
    expect(output).not.toContain('\u{1F4E6}');
    expect(output).not.toContain('\u{1F527}');
  });

  it('prints "No known vulnerabilities found." when a single clean scope is audited', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);

    expect(output).toContain('\u{1F52C} Auditing prod dependencies ...');
    expect(output).toContain('No known vulnerabilities found.');
  });

  // -- Intro banner --

  it('includes "dev" in the intro banner when only dev is audited', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['dev'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{1F52C} Auditing dev dependencies ...');
  });

  it('omits scope name from intro banner when both scopes are audited', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{1F52C} Auditing dependencies ...');
  });

  // -- Multi-scope with findings --

  it('shows scope headers when multiple scopes are audited and at least one has findings', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
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

    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).toContain('  \u{1F4E6} prod:');
    expect(output).toContain('  \u{1F527} dev:');
  });

  it('shows "No known vulnerabilities found." for a clean scope when another has findings', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        belowThreshold: [],
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

    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).toContain('  \u{1F4E6} prod:');
    expect(output).toContain('  No known vulnerabilities found.');
    expect(output).toContain('  \u{1F527} dev:');
    expect(output).toContain('GHSA-dev1');
  });

  // -- Actions footer --

  it('appends an Actions footer with verbose and sync hints when unallowed vulnerabilities exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-bad', path: 'pkg', paths: ['pkg'], url: 'https://example.com/bad' }],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('Run `v11y check --prod --verbose` for full report');
    expect(output).toContain('Run `v11y sync` to add the listed vulnerabilities to the allowlist.');
  });

  it('appends an Actions footer with the remove-only hint when only stale entries exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('Run `v11y sync` to remove stale allowlist entries.');
    expect(output).not.toContain('--verbose');
  });

  it('appends an Actions footer combining both hints when unallowed and stale both exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [{ id: 'GHSA-bad', path: 'pkg', paths: ['pkg'], url: 'https://example.com/bad' }],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('add the listed vulnerabilities to the allowlist and remove stale entries');
  });

  it('omits the Actions footer when the allowlist is fully current', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).not.toContain('Actions:');
  });

  it('shows verbose hint when only allowed vulns exist, without any unallowed or stale entries', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          { id: '1', ghsaId: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/1' },
        ],
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('Run `v11y check --prod --verbose` for full report');
    expect(output).not.toContain('v11y sync');
  });

  // -- Actions footer (multi-scope) --

  it('appends Actions footer with verbose and sync hints when multi-scope has unallowed vulnerabilities', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          {
            id: 'GHSA-p1',
            ghsaId: 'GHSA-p1',
            path: 'pkg-a',
            paths: ['pkg-a'],
            severity: 'high',
            url: 'https://example.com/p1',
          },
        ],
      },
    });

    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('Run `v11y check --verbose` for full report');
    expect(output).toContain('Run `v11y sync` to add the listed vulnerabilities to the allowlist.');
  });

  it('appends Actions footer with remove-only sync hint when multi-scope has only stale entries', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale-dev' }],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('Run `v11y sync` to remove stale allowlist entries.');
    expect(output).not.toContain('--verbose');
  });

  it('appends Actions footer with combined sync hint when multi-scope has both unallowed and stale', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale-prod' }],
        unallowed: [
          {
            id: 'GHSA-bad',
            ghsaId: 'GHSA-bad',
            path: 'pkg',
            paths: ['pkg'],
            severity: 'critical',
            url: 'https://example.com/bad',
          },
        ],
      },
      dev: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('add the listed vulnerabilities to the allowlist and remove stale entries');
    expect(output).toContain('Run `v11y check --verbose` for full report');
  });
});

// -- formatCheckText: plain style --

describe(`${formatCheckText.name} in plain style`, () => {
  it('does not print any pictographic character for multiple scopes', () => {
    const output = formatCheckText(buildPopulatedCheckResult(), ['prod', 'dev'], 'plain', FIXED_NOW, {
      dev: 'high',
      prod: 'moderate',
    });

    expect(output).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('does not print any pictographic character for a single scope', () => {
    const output = formatCheckText(buildPopulatedCheckResult(), ['prod'], 'plain', FIXED_NOW, { prod: 'moderate' });

    expect(output).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('states each status in words, aligned across markers', () => {
    const output = formatCheckText(buildPopulatedCheckResult(), ['prod'], 'plain', FIXED_NOW, { prod: 'moderate' });

    expect(output.split('\n').slice(0, 6)).toStrictEqual([
      'Auditing prod dependencies (threshold: moderate) ...',
      '  \u{2022} FAIL  GHSA-prod-unallowed: lodash  high',
      '  \u{2022} PASS  GHSA-prod-allowed: express  moderate \u{2022} allowed since 2 weeks ago (2026-04-01T00:00:00.000Z)',
      '  \u{2022} PASS  1002: qs  info \u{2022} allowed (not-a-date)',
      '  \u{2022} STALE GHSA-prod-stale \u{2022} not needed',
      '  \u{2022} SKIP  GHSA-prod-low: brace-expansion  low \u{2022} ignored',
    ]);
  });

  it('labels each scope without a glyph', () => {
    const output = formatCheckText(buildPopulatedCheckResult(), ['prod', 'dev'], 'plain', FIXED_NOW, {
      dev: 'high',
      prod: 'moderate',
    });

    expect(output).toContain('\n  prod: (threshold: moderate)\n');
    expect(output).toContain('\n  dev: (threshold: high)\n');
  });
});

describe(`${formatCheckText.name} in rich style`, () => {
  it('marks each row with one glyph, its status', () => {
    const output = formatCheckText(buildPopulatedCheckResult(), ['prod'], 'rich', FIXED_NOW, { prod: 'moderate' });

    expect(output.split('\n').slice(0, 6)).toStrictEqual([
      '\u{1F52C} Auditing prod dependencies (threshold: \u{1F7E0} moderate) ...',
      '  \u{2022} \u{274C} GHSA-prod-unallowed: lodash  \u{1F534} high',
      '  \u{2022} \u{2705} GHSA-prod-allowed: express  \u{1F7E0} moderate \u{2022} allowed since 2 weeks ago (2026-04-01T00:00:00.000Z)',
      '  \u{2022} \u{2705} 1002: qs  \u{1F7E1} info \u{2022} allowed (not-a-date)',
      '  \u{2022} \u{1F9F9} GHSA-prod-stale \u{2022} not needed',
      '  \u{2022} \u{23E9} GHSA-prod-low: brace-expansion  \u{1F7E1} low \u{2022} ignored',
    ]);
  });
});
