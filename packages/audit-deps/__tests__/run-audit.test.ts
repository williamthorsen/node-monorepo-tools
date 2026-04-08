import { describe, expect, it } from 'vitest';

import { extractStaleEntries, parseAuditCiOutput } from '../src/run-audit.ts';

describe(parseAuditCiOutput, () => {
  it('parses advisories from a flat advisories object', () => {
    const json = JSON.stringify({
      advisories: {
        '1234': {
          id: 1234,
          module_name: 'lodash',
          url: 'https://github.com/advisories/GHSA-1234',
          findings: [{ paths: ['lodash>underscore'] }],
        },
      },
    });

    const { results } = parseAuditCiOutput(json);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: '1234',
      path: 'lodash>underscore',
      url: 'https://github.com/advisories/GHSA-1234',
    });
  });

  it('parses advisories from an array-of-objects shape', () => {
    const json = JSON.stringify([
      {
        advisories: {
          '5678': {
            id: 5678,
            module_name: 'express',
            url: 'https://example.com/5678',
            findings: [{ paths: ['express'] }],
          },
        },
      },
    ]);

    const { results } = parseAuditCiOutput(json);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('5678');
  });

  it('parses advisory with GHSA-format string ID', () => {
    const json = JSON.stringify({
      advisories: {
        'GHSA-23c5-xmqv-rm74': {
          id: 'GHSA-23c5-xmqv-rm74',
          module_name: 'some-pkg',
          url: 'https://github.com/advisories/GHSA-23c5-xmqv-rm74',
          findings: [{ paths: ['some-pkg>dep'] }],
        },
      },
    });

    const { results } = parseAuditCiOutput(json);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: 'GHSA-23c5-xmqv-rm74',
      path: 'some-pkg>dep',
      url: 'https://github.com/advisories/GHSA-23c5-xmqv-rm74',
    });
  });

  it('returns empty results and no warnings for invalid JSON when input is empty', () => {
    const { results, warnings } = parseAuditCiOutput('');
    expect(results).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('returns empty results with a warning for non-empty invalid JSON', () => {
    const { results, warnings } = parseAuditCiOutput('not json');
    expect(results).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Failed to parse/);
  });

  it('returns empty results for JSON with no advisories', () => {
    const { results } = parseAuditCiOutput(JSON.stringify({}));
    expect(results).toEqual([]);
  });

  it('uses module_name as fallback path when findings are empty', () => {
    const json = JSON.stringify({
      advisories: {
        '9999': {
          id: 9999,
          module_name: 'some-pkg',
          url: 'https://example.com/9999',
          findings: [],
        },
      },
    });

    const { results } = parseAuditCiOutput(json);
    expect(results[0]?.path).toBe('some-pkg');
  });
});

describe(extractStaleEntries, () => {
  it('extracts stale entries from allowlistedAdvisoriesNotFound', () => {
    const json = JSON.stringify({
      allowlistedAdvisoriesNotFound: ['GHSA-old1', 'GHSA-old2'],
    });

    expect(extractStaleEntries(json).entries).toEqual(['GHSA-old1', 'GHSA-old2']);
  });

  it('returns empty entries when no stale entries exist', () => {
    expect(extractStaleEntries(JSON.stringify({})).entries).toEqual([]);
  });

  it('returns empty entries and no warnings for empty input', () => {
    const { entries, warnings } = extractStaleEntries('');
    expect(entries).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('returns empty entries with a warning for non-empty invalid JSON', () => {
    const { entries, warnings } = extractStaleEntries('not json');
    expect(entries).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Failed to parse/);
  });
});
