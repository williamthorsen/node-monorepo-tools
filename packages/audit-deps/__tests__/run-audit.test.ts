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

    const results = parseAuditCiOutput(json);
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

    const results = parseAuditCiOutput(json);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('5678');
  });

  it('returns an empty array for invalid JSON', () => {
    expect(parseAuditCiOutput('not json')).toEqual([]);
  });

  it('returns an empty array for JSON with no advisories', () => {
    expect(parseAuditCiOutput(JSON.stringify({}))).toEqual([]);
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

    const results = parseAuditCiOutput(json);
    expect(results[0]?.path).toBe('some-pkg');
  });
});

describe(extractStaleEntries, () => {
  it('extracts stale entries from allowlistedAdvisoriesNotFound', () => {
    const json = JSON.stringify({
      allowlistedAdvisoriesNotFound: ['GHSA-old1', 'GHSA-old2'],
    });

    expect(extractStaleEntries(json)).toEqual(['GHSA-old1', 'GHSA-old2']);
  });

  it('returns an empty array when no stale entries exist', () => {
    expect(extractStaleEntries(JSON.stringify({}))).toEqual([]);
  });

  it('returns an empty array for invalid JSON', () => {
    expect(extractStaleEntries('not json')).toEqual([]);
  });
});
