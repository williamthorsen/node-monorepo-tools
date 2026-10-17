import { describe, expect, it } from 'vitest';

import { formatCheckText } from '../format-check.ts';
import { makeCheckResult } from '../test-utils/check-result-fixtures.ts';

const FIXED_NOW = new Date('2026-04-15T00:00:00Z');

// -- formatCheckText --

describe(formatCheckText, () => {
  // -- Unallowed vulnerabilities --

  it('lists unallowed vulnerabilities with GHSA ID and severity suffix', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
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

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('  \u{2022} \u{274C} GHSA-abcd-efgh-1234: .>path>to>dep  \u{1F534} critical');
  });

  it('falls back to numeric ID when ghsaId is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: '1234', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{274C} 1234: pkg');
  });

  it('omits severity suffix when severity is undefined', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-1', ghsaId: 'GHSA-1', path: 'pkg', paths: ['pkg'], url: 'https://example.com/1' }],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('  \u{2022} \u{274C} GHSA-1: pkg');
    expect(output).not.toContain('\u{1F534}');
    expect(output).not.toContain('\u{1F7E0}');
  });

  // -- Allowed vulnerabilities --

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
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['dev'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{2705} GHSA-allowed: express  \u{1F7E0} moderate');
    expect(output).toContain('\u{2022} allowed since 2 weeks ago (2026-04-01T00:00:00.000Z)');
  });

  it('renders "allowed (addedAt)" without "since" when addedAt is unparseable', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: 'not-a-date',
            id: 'GHSA-baddate',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/baddate',
          },
        ],
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{2022} allowed (not-a-date)');
    expect(output).not.toContain('since');
  });

  it('omits "allowed since" suffix when addedAt is absent', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: '1234', ghsaId: 'GHSA-nodate', path: 'pkg', paths: ['pkg'], url: 'https://example.com' }],
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('GHSA-nodate');
    expect(output).not.toContain('allowed');
  });

  // -- Stale entries --

  it('renders stale entries with bullet format', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('  \u{2022} \u{1F9F9} GHSA-old \u{2022} not needed');
  });

  // -- Mixed findings --

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
        belowThreshold: [],
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

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('GHSA-bad');
    expect(output).toContain('GHSA-ok');
    expect(output).toContain('GHSA-stale');
  });

  it('renders only requested scopes', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'dev1', ghsaId: 'GHSA-dev', path: 'pkg', paths: ['pkg'], url: 'https://example.com/dev' }],
      },
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'prod1', ghsaId: 'GHSA-prod', path: 'pkg', paths: ['pkg'], url: 'https://example.com/prod' }],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('GHSA-prod');
    expect(output).not.toContain('GHSA-dev');
  });

  // -- Below-threshold vulnerabilities --

  it('renders below-threshold vulnerabilities with "ignored" annotation', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [
          {
            id: 'GHSA-low',
            ghsaId: 'GHSA-low',
            path: 'brace-expansion',
            paths: ['brace-expansion'],
            severity: 'low',
            url: 'https://example.com/low',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{23E9} GHSA-low: brace-expansion');
    expect(output).toContain('\u{2022} ignored');
  });

  it('does not print "No known vulnerabilities found." when only below-threshold vulns exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [
          { id: 'GHSA-bt', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/bt' },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).not.toContain('No known vulnerabilities found.');
  });

  // -- Threshold annotation --

  it('shows threshold in intro banner for single-scope when above low', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW, { prod: 'moderate' });
    expect(output).toContain('\u{1F52C} Auditing prod dependencies (threshold: \u{1F7E0} moderate) ...');
  });

  it('omits threshold from intro banner when threshold is low', () => {
    const result = makeCheckResult();
    const output = formatCheckText(result, ['prod'], 'rich', FIXED_NOW, { prod: 'low' });
    expect(output).toContain('\u{1F52C} Auditing prod dependencies ...');
    expect(output).not.toContain('threshold:');
  });

  it('shows threshold in scope headers for multi-scope when above low', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [
          { id: 'GHSA-bt', path: 'pkg', paths: ['pkg'], severity: 'low', url: 'https://example.com/bt' },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW, { prod: 'moderate', dev: 'high' });
    expect(output).toContain('\u{1F4E6} prod: (threshold: \u{1F7E0} moderate)');
    expect(output).toContain('\u{1F527} dev: (threshold: \u{1F534} high)');
  });

  it('renders below-threshold vulnerability line in multi-scope output', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [
          {
            id: 'GHSA-bt',
            ghsaId: 'GHSA-bt',
            path: 'brace-expansion',
            paths: ['brace-expansion'],
            severity: 'low',
            url: 'https://example.com/bt',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckText(result, ['prod', 'dev'], 'rich', FIXED_NOW, { prod: 'moderate' });
    expect(output).toContain('\u{23E9} GHSA-bt: brace-expansion');
    expect(output).toContain('\u{2022} ignored');
    expect(output).toContain('\u{1F4E6} prod: (threshold: \u{1F7E0} moderate)');
  });
});
