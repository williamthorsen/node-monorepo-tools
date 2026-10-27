import { describe, expect, it } from 'vitest';

import { formatCheckJson } from '../format-check.ts';
import { makeCheckResult } from '../test-utils/check-result-fixtures.ts';

describe(formatCheckJson, () => {
  it('produces parseable JSON with requested scopes', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
        belowThreshold: [],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
    });

    const parsedOutput: unknown = JSON.parse(formatCheckJson(result, ['prod']));
    expect(parsedOutput).toStrictEqual({
      prod: {
        allowed: [{ id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' }],
        belowThreshold: [],
        stale: [{ id: 'GHSA-old' }],
        unallowed: [],
      },
      summary: { status: 'suppressed-vulnerabilities', count: 1 },
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
        belowThreshold: [],
        stale: [],
        unallowed: [],
      },
    });

    const parsedOutput: unknown = JSON.parse(formatCheckJson(result, ['prod']));
    expect(parsedOutput).toMatchObject({
      prod: {
        allowed: [
          {
            addedAt: '2026-04-01T00:00:00.000Z',
            cvss: { score: 7.5 },
            description: 'Detailed description',
            paths: ['pkg', 'other-pkg>pkg'],
            reason: 'Accepted risk',
            title: 'Prototype pollution',
          },
        ],
      },
    });
  });

  it('includes below-threshold array in JSON output', () => {
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

    const parsedOutput: unknown = JSON.parse(formatCheckJson(result, ['prod']));
    expect(parsedOutput).toMatchObject({
      prod: { belowThreshold: [expect.objectContaining({ id: 'GHSA-bt', severity: 'low' })] },
    });
  });

  it('includes only requested scopes', () => {
    const result = makeCheckResult();
    const parsedOutput: unknown = JSON.parse(formatCheckJson(result, ['dev']));
    expect(parsedOutput).toHaveProperty('dev');
    expect(parsedOutput).not.toHaveProperty('prod');
  });

  it('includes a top-level summary block derived from the result', () => {
    const result = makeCheckResult({
      prod: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [
          { id: 'GHSA-1', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/1' },
          { id: 'GHSA-2', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/2' },
        ],
      },
    });

    const parsedOutput: unknown = JSON.parse(formatCheckJson(result, ['prod', 'dev']));
    expect(parsedOutput).toMatchObject({ summary: { status: 'vulnerabilities-found', count: 2 } });
  });

  it('emits summary { status: "none", count: 0 } for a clean result', () => {
    const parsedOutput: unknown = JSON.parse(formatCheckJson(makeCheckResult(), ['prod', 'dev']));
    expect(parsedOutput).toMatchObject({ summary: { status: 'none', count: 0 } });
  });

  it('derives the summary across only the requested scopes', () => {
    const result = makeCheckResult({
      dev: {
        allowed: [],
        belowThreshold: [],
        stale: [],
        unallowed: [{ id: 'GHSA-dev', path: 'pkg', paths: ['pkg'], severity: 'high', url: 'https://example.com/d' }],
      },
    });

    const prodOnlyOutput: unknown = JSON.parse(formatCheckJson(result, ['prod']));
    expect(prodOnlyOutput).toMatchObject({ summary: { status: 'none', count: 0 } });

    const devOnlyOutput: unknown = JSON.parse(formatCheckJson(result, ['dev']));
    expect(devOnlyOutput).toMatchObject({ summary: { status: 'vulnerabilities-found', count: 1 } });
  });
});
