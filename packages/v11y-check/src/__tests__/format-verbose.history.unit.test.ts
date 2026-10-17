import { describe, expect, it } from 'vitest';

import { formatCheckVerboseText } from '../format-verbose.ts';
import { makeCheckResult } from '../test-utils/check-result-fixtures.ts';

const FIXED_NOW = new Date('2026-04-15T00:00:00Z');

// -- formatCheckVerboseText --

describe(formatCheckVerboseText, () => {
  // -- Allowed entries --

  it('renders an allowed entry with the passed marker and "allowed X ago (YYYY-MM-DD)"', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: '2026-04-01',
            ghsaId: 'GHSA-allowed',
            id: '1234',
            path: 'pkg',
            paths: ['pkg'],
            reason: 'Accepted risk: no user input reaches this path',
            severity: 'moderate',
            title: 'Regex denial of service',
            url: 'https://example.com/allowed',
          },
        ],
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{2705} GHSA-allowed');
    expect(output).toContain('allowed 2 weeks ago (2026-04-01)');
    expect(output).toContain('reason: Accepted risk: no user input reaches this path');
    expect(output).toContain('Regex denial of service');
    expect(output).toContain('\u{1F7E0} moderate');
  });

  it('renders an allowed entry with a full ISO datetime in the suffix', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [
          {
            addedAt: '2026-04-01T14:30:00.000Z',
            id: 'GHSA-iso',
            path: 'pkg',
            paths: ['pkg'],
            url: 'https://example.com/iso',
          },
        ],
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('allowed 1 week ago (2026-04-01T14:30:00.000Z)');
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
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
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
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
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
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).not.toContain('reason:');
  });

  // -- Stale entries --

  it('renders stale entries as a single "🧹 <id>  not needed" line', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale-entry-0000' }],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('  \u{1F9F9} GHSA-stale-entry-0000  not needed');
  });

  it('ends output with a newline when actions are present', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toMatch(/\n$/);
  });

  it('separates the Actions footer from scope content with a blank line', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [{ id: 'GHSA-stale' }],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('not needed\n\n');
    expect(output).toContain('Actions:');
  });

  it('appends an Actions footer when unallowed or stale entries exist', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
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

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('Actions:');
    expect(output).toContain('add the listed vulnerabilities to the allowlist and remove stale entries');
  });

  it('omits the Actions footer when the allowlist is fully current', () => {
    const output = formatCheckVerboseText(makeCheckResult(), ['prod', 'dev'], 'rich', FIXED_NOW);
    expect(output).not.toContain('Actions:');
  });

  // -- Below-threshold entries --

  it('renders a below-threshold vulnerability with the skipped marker and "ignored (below threshold)" annotation', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [
          {
            ghsaId: 'GHSA-low',
            id: '1234',
            path: 'brace-expansion',
            paths: ['my-app>brace-expansion'],
            severity: 'low',
            title: 'ReDoS in brace-expansion',
            url: 'https://github.com/advisories/GHSA-low',
          },
        ],
        stale: [],
        unallowed: [],
      },
    });

    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW);
    expect(output).toContain('\u{23E9} GHSA-low');
    expect(output).toContain('\u{1F7E1} low');
    expect(output).toContain('ignored (below threshold)');
    expect(output).toContain('ReDoS in brace-expansion');
    expect(output).toContain('path: my-app>brace-expansion');
    expect(output).toContain('link: https://github.com/advisories/GHSA-low');
  });

  it('shows threshold in scope header when above low', () => {
    const result = makeCheckResult();
    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW, { prod: 'moderate' });
    expect(output).toContain('-- \u{1F4E6} prod -- (threshold: \u{1F7E0} moderate)');
  });

  it('omits threshold from scope header when threshold is low', () => {
    const result = makeCheckResult();
    const output = formatCheckVerboseText(result, ['prod'], 'rich', FIXED_NOW, { prod: 'low' });
    expect(output).toContain('-- \u{1F4E6} prod --');
    expect(output).not.toContain('threshold:');
  });
});
