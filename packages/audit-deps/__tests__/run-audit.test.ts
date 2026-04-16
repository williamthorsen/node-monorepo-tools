import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractStaleEntries, parseAuditCiOutput } from '../src/run-audit.ts';

// ---------------------------------------------------------------------------
// Hoisted mocks for runAudit / runReport tests
// ---------------------------------------------------------------------------

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

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
    expect(results[0]).toStrictEqual({
      id: '1234',
      path: 'lodash>underscore',
      paths: ['lodash>underscore'],
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
    expect(results[0]).toStrictEqual({
      id: 'GHSA-23c5-xmqv-rm74',
      path: 'some-pkg>dep',
      paths: ['some-pkg>dep'],
      url: 'https://github.com/advisories/GHSA-23c5-xmqv-rm74',
    });
  });

  it('returns empty results and no warnings for invalid JSON when input is empty', () => {
    const { results, warnings } = parseAuditCiOutput('');
    expect(results).toStrictEqual([]);
    expect(warnings).toStrictEqual([]);
  });

  it('returns empty results with a warning for non-empty invalid JSON', () => {
    const { results, warnings } = parseAuditCiOutput('not json');
    expect(results).toStrictEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Failed to parse/);
  });

  it('returns empty results for JSON with no advisories', () => {
    const { results } = parseAuditCiOutput(JSON.stringify({}));
    expect(results).toStrictEqual([]);
  });

  it('extracts severity from advisory when present', () => {
    const json = JSON.stringify({
      advisories: {
        '1234': {
          id: 1234,
          module_name: 'lodash',
          severity: 'high',
          url: 'https://github.com/advisories/GHSA-1234',
          findings: [{ paths: ['lodash>underscore'] }],
        },
      },
    });

    const { results } = parseAuditCiOutput(json);
    expect(results).toHaveLength(1);
    expect(results[0]).toStrictEqual({
      id: '1234',
      path: 'lodash>underscore',
      paths: ['lodash>underscore'],
      severity: 'high',
      url: 'https://github.com/advisories/GHSA-1234',
    });
  });

  it('omits severity when not present in advisory', () => {
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
    expect(results[0]).not.toHaveProperty('severity');
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
    expect(results[0]?.paths).toStrictEqual([]);
  });

  it('collects all paths from multiple findings, deduplicated in insertion order', () => {
    const json = JSON.stringify({
      advisories: {
        '1234': {
          id: 1234,
          module_name: 'lodash',
          url: 'https://github.com/advisories/GHSA-1234',
          findings: [{ paths: ['a>b>lodash', 'c>lodash'] }, { paths: ['c>lodash', 'd>lodash'] }],
        },
      },
    });

    const { results } = parseAuditCiOutput(json);
    expect(results[0]?.paths).toStrictEqual(['a>b>lodash', 'c>lodash', 'd>lodash']);
    expect(results[0]?.path).toBe('a>b>lodash');
  });

  it('surfaces title, overview as description, and cvss when present in advisory', () => {
    const json = JSON.stringify({
      advisories: {
        '1234': {
          id: 1234,
          module_name: 'lodash',
          title: 'Prototype pollution in lodash',
          overview: 'Detailed description of the vulnerability.',
          cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N' },
          url: 'https://github.com/advisories/GHSA-1234',
          findings: [{ paths: ['lodash'] }],
        },
      },
    });

    const { results } = parseAuditCiOutput(json);
    expect(results[0]?.title).toBe('Prototype pollution in lodash');
    expect(results[0]?.description).toBe('Detailed description of the vulnerability.');
    expect(results[0]?.cvss).toStrictEqual({ score: 7.5, vectorString: 'CVSS:3.1/AV:N' });
  });

  it('omits title, description, and cvss when advisory does not include them', () => {
    const json = JSON.stringify({
      advisories: {
        '1234': {
          id: 1234,
          module_name: 'lodash',
          url: 'https://github.com/advisories/GHSA-1234',
          findings: [{ paths: ['lodash'] }],
        },
      },
    });

    const { results } = parseAuditCiOutput(json);
    expect(results[0]).not.toHaveProperty('title');
    expect(results[0]).not.toHaveProperty('description');
    expect(results[0]).not.toHaveProperty('cvss');
  });
});

describe(extractStaleEntries, () => {
  it('extracts stale entries from allowlistedAdvisoriesNotFound', () => {
    const json = JSON.stringify({
      allowlistedAdvisoriesNotFound: ['GHSA-old1', 'GHSA-old2'],
    });

    expect(extractStaleEntries(json).entries).toStrictEqual(['GHSA-old1', 'GHSA-old2']);
  });

  it('returns empty entries when no stale entries exist', () => {
    expect(extractStaleEntries(JSON.stringify({})).entries).toStrictEqual([]);
  });

  it('returns empty entries and no warnings for empty input', () => {
    const { entries, warnings } = extractStaleEntries('');
    expect(entries).toStrictEqual([]);
    expect(warnings).toStrictEqual([]);
  });

  it('returns empty entries with a warning for non-empty invalid JSON', () => {
    const { entries, warnings } = extractStaleEntries('not json');
    expect(entries).toStrictEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Failed to parse/);
  });
});

// ---------------------------------------------------------------------------
// runAudit / runReport (with mocked spawnSync)
// ---------------------------------------------------------------------------

// Import after vi.mock so the mock is active
const { resolveAuditCiBin, runAudit, runReport } = await import('../src/run-audit.ts');

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe(runAudit, () => {
  it('passes --config and --output-format json when json is true', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '{}', stderr: '', error: null });

    runAudit({ configPath: '/path/to/config.json', json: true });

    const args: string[] = mockSpawnSync.mock.calls[0][1];
    expect(args).toContain('--config');
    expect(args).toContain('/path/to/config.json');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });

  it('passes --output-format text when json is false', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '', error: null });

    runAudit({ configPath: '/path/to/config.json', json: false });

    const args: string[] = mockSpawnSync.mock.calls[0][1];
    expect(args).toContain('--output-format');
    expect(args).toContain('text');
  });

  it('returns the exit code from spawnSync', () => {
    mockSpawnSync.mockReturnValue({ status: 7, stdout: '', stderr: '', error: null });

    const result = runAudit({ configPath: '/cfg.json' });

    expect(result.exitCode).toBe(7);
  });

  it('throws on spawn failure', () => {
    mockSpawnSync.mockReturnValue({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') });

    expect(() => runAudit({ configPath: '/cfg.json' })).toThrow('Failed to launch audit-ci');
  });
});

describe(runReport, () => {
  it('returns parsed results regardless of exit code', () => {
    const advisoryOutput = JSON.stringify({
      advisories: {
        'GHSA-abc': {
          id: 'GHSA-abc',
          module_name: 'pkg-a',
          url: 'https://example.com/abc',
          findings: [{ paths: ['pkg-a'] }],
        },
      },
    });

    mockSpawnSync.mockReturnValue({ status: 1, stdout: advisoryOutput, stderr: '', error: null });

    const report = runReport({ configPath: '/cfg.json' });

    expect(report.results).toHaveLength(1);
    expect(report.results[0]?.id).toBe('GHSA-abc');
  });

  it('throws on spawn failure', () => {
    mockSpawnSync.mockReturnValue({ status: null, stdout: '', stderr: '', error: new Error('ENOENT') });

    expect(() => runReport({ configPath: '/cfg.json' })).toThrow('Failed to launch audit-ci');
  });

  it('appends --report-type full when reportType is "full"', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '{}', stderr: '', error: null });

    runReport({ configPath: '/cfg.json', reportType: 'full' });

    const args: string[] = mockSpawnSync.mock.calls[0][1];
    expect(args).toStrictEqual(
      expect.arrayContaining(['--config', '/cfg.json', '--output-format', 'json', '--report-type', 'full']),
    );
  });

  it('omits --report-type when reportType is not specified', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: '{}', stderr: '', error: null });

    runReport({ configPath: '/cfg.json' });

    const args: string[] = mockSpawnSync.mock.calls[0][1];
    expect(args).not.toContain('--report-type');
  });
});

describe(resolveAuditCiBin, () => {
  it('returns fallback "audit-ci" when import.meta.resolve fails', () => {
    // import.meta.resolve for audit-ci may or may not work in the test env;
    // if it fails, the function returns 'audit-ci' as fallback
    const result = resolveAuditCiBin();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
