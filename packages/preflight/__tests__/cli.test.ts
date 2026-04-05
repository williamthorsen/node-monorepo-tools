import path from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { PreflightCollection } from '../src/types.ts';

const mockLoadPreflightCollection = vi.hoisted(() => vi.fn());
const mockRunPreflight = vi.hoisted(() => vi.fn());
const mockReportPreflight = vi.hoisted(() => vi.fn());
const mockFormatCombinedSummary = vi.hoisted(() => vi.fn());
const mockFormatJsonReport = vi.hoisted(() => vi.fn());
const mockFormatJsonError = vi.hoisted(() => vi.fn());
const mockResolveGitHubToken = vi.hoisted(() => vi.fn());
const mockLoadRemoteCollection = vi.hoisted(() => vi.fn());

vi.mock('../src/config.ts', () => ({
  loadPreflightCollection: mockLoadPreflightCollection,
}));

vi.mock('../src/runPreflight.ts', () => ({
  meetsThreshold: (severity: string, threshold: string) => {
    const rank: Record<string, number> = { error: 0, warn: 1, recommend: 2 };
    const severityRank = rank[severity];
    const thresholdRank = rank[threshold];
    if (severityRank === undefined || thresholdRank === undefined) {
      throw new Error(`Invalid severity in meetsThreshold mock: severity="${severity}", threshold="${threshold}"`);
    }
    return severityRank <= thresholdRank;
  },
  runPreflight: mockRunPreflight,
}));

vi.mock('../src/reportPreflight.ts', () => ({
  reportPreflight: mockReportPreflight,
}));

vi.mock('../src/formatCombinedSummary.ts', () => ({
  formatCombinedSummary: mockFormatCombinedSummary,
}));

vi.mock('../src/formatJsonReport.ts', () => ({
  formatJsonReport: mockFormatJsonReport,
}));

vi.mock('../src/formatJsonError.ts', () => ({
  formatJsonError: mockFormatJsonError,
}));

vi.mock('../src/resolveGitHubToken.ts', () => ({
  resolveGitHubToken: mockResolveGitHubToken,
}));

vi.mock('../src/loadRemoteCollection.ts', () => ({
  loadRemoteCollection: mockLoadRemoteCollection,
}));

import { parseRunArgs, runCommand } from '../src/cli.ts';

function makeCollection(overrides?: Partial<PreflightCollection>): PreflightCollection {
  return {
    checklists: [
      { name: 'deploy', checks: [{ name: 'a', check: () => true }] },
      { name: 'infra', checks: [{ name: 'b', check: () => true }] },
    ],
    ...overrides,
  };
}

describe(parseRunArgs, () => {
  it('defaults to the default collection path when no flags are given', () => {
    const result = parseRunArgs([]);

    expect(result.collectionSource).toStrictEqual({ path: '.preflight/collections/default.ts' });
    expect(result.json).toBe(false);
  });

  it('parses positional names with default collection path', () => {
    const result = parseRunArgs(['deploy', 'infra']);

    expect(result.names).toStrictEqual(['deploy', 'infra']);
    expect(result.collectionSource).toStrictEqual({ path: '.preflight/collections/default.ts' });
  });

  // --collection flag (standalone, without --github)
  it('resolves --collection to a local convention path', () => {
    const result = parseRunArgs(['--collection', 'deploy']);

    expect(result.collectionSource).toStrictEqual({ path: '.preflight/collections/deploy.ts' });
  });

  it('resolves --collection with a slash-separated path', () => {
    const result = parseRunArgs(['--collection', 'shared/deploy']);

    expect(result.collectionSource).toStrictEqual({ path: '.preflight/collections/shared/deploy.ts' });
  });

  it('resolves --collection= to a local convention path', () => {
    const result = parseRunArgs(['--collection=deploy']);

    expect(result.collectionSource).toStrictEqual({ path: '.preflight/collections/deploy.ts' });
  });

  // --file flag
  it('parses --file flag', () => {
    const result = parseRunArgs(['--file', 'custom/path.ts']);

    expect(result.collectionSource).toStrictEqual({ path: 'custom/path.ts' });
    expect(result.names).toStrictEqual([]);
  });

  it('parses --file= syntax', () => {
    const result = parseRunArgs(['--file=custom/path.ts']);

    expect(result.collectionSource).toStrictEqual({ path: 'custom/path.ts' });
  });

  it('throws when --file has no value', () => {
    expect(() => parseRunArgs(['--file'])).toThrow('--file requires a path argument');
  });

  it('throws when --file= has an empty value', () => {
    expect(() => parseRunArgs(['--file='])).toThrow('--file requires a path argument');
  });

  // --json flag
  it('parses --json flag', () => {
    const result = parseRunArgs(['--json']);

    expect(result.json).toBe(true);
    expect(result.names).toStrictEqual([]);
  });

  it('parses --json with positional names', () => {
    const result = parseRunArgs(['--json', 'deploy']);

    expect(result.json).toBe(true);
    expect(result.names).toStrictEqual(['deploy']);
  });

  it('throws on unknown flags', () => {
    expect(() => parseRunArgs(['--unknown'])).toThrow("unknown flag '--unknown'");
  });

  // --config is no longer supported
  it('rejects --config as an unknown flag', () => {
    expect(() => parseRunArgs(['--config', 'x'])).toThrow("unknown flag '--config'");
  });

  // Short options
  it('parses -c as short form of --collection', () => {
    const result = parseRunArgs(['-c', 'deploy']);

    expect(result.collectionSource).toStrictEqual({ path: '.preflight/collections/deploy.ts' });
  });

  it('parses -f as short form of --file', () => {
    const result = parseRunArgs(['-f', 'custom/path.ts']);

    expect(result.collectionSource).toStrictEqual({ path: 'custom/path.ts' });
  });

  it('parses -g as short form of --github', () => {
    const result = parseRunArgs(['-g', 'org/repo', '-c', 'nmr']);

    expect(result.collectionSource).toStrictEqual({
      url: 'https://raw.githubusercontent.com/org/repo/main/.preflight/collections/nmr.js',
    });
  });

  it('parses -u as short form of --url', () => {
    const result = parseRunArgs(['-u', 'https://example.com/config.js']);

    expect(result.collectionSource).toStrictEqual({ url: 'https://example.com/config.js' });
  });

  it('parses -j as short form of --json', () => {
    const result = parseRunArgs(['-j']);

    expect(result.json).toBe(true);
  });

  it('parses -F as short form of --fail-on', () => {
    const result = parseRunArgs(['-F', 'warn']);

    expect(result.failOn).toBe('warn');
  });

  it('parses -R as short form of --report-on', () => {
    const result = parseRunArgs(['-R', 'error']);

    expect(result.reportOn).toBe('error');
  });

  // --github flag
  it('parses --github with --collection', () => {
    const result = parseRunArgs(['--github', 'org/repo@v1', '--collection', 'nmr']);

    expect(result.collectionSource).toStrictEqual({
      url: 'https://raw.githubusercontent.com/org/repo/v1/.preflight/collections/nmr.js',
    });
  });

  it('parses --github= with --collection=', () => {
    const result = parseRunArgs(['--github=org/repo', '--collection=nmr']);

    expect(result.collectionSource).toStrictEqual({
      url: 'https://raw.githubusercontent.com/org/repo/main/.preflight/collections/nmr.js',
    });
  });

  it('defaults --github ref to main', () => {
    const result = parseRunArgs(['--github', 'org/repo', '--collection', 'nmr']);

    expect(result.collectionSource).toStrictEqual({
      url: 'https://raw.githubusercontent.com/org/repo/main/.preflight/collections/nmr.js',
    });
  });

  it('defaults --github collection to default when --collection is omitted', () => {
    const result = parseRunArgs(['--github', 'org/repo']);

    expect(result.collectionSource).toStrictEqual({
      url: 'https://raw.githubusercontent.com/org/repo/main/.preflight/collections/default.js',
    });
  });

  it('throws when --github has no value', () => {
    expect(() => parseRunArgs(['--github'])).toThrow('--github requires a repository argument');
  });

  it('throws when --github= has an empty value', () => {
    expect(() => parseRunArgs(['--github='])).toThrow('--github requires a repository argument');
  });

  it('throws when --collection has no value', () => {
    expect(() => parseRunArgs(['--collection'])).toThrow('--collection requires a collection name');
  });

  // --url flag
  it('parses --url flag with space-separated value', () => {
    const result = parseRunArgs(['--url', 'https://example.com/config.js']);

    expect(result.collectionSource).toStrictEqual({ url: 'https://example.com/config.js' });
  });

  it('parses --url= syntax', () => {
    const result = parseRunArgs(['--url=https://example.com/config.js']);

    expect(result.collectionSource).toStrictEqual({ url: 'https://example.com/config.js' });
  });

  it('throws when --url has no value', () => {
    expect(() => parseRunArgs(['--url'])).toThrow('--url requires a URL argument');
  });

  it('throws when --url= has an empty value', () => {
    expect(() => parseRunArgs(['--url='])).toThrow('--url requires a URL argument');
  });

  // --local flag
  it('resolves --local to a .js file under .preflight/collections/', () => {
    const result = parseRunArgs(['--local', '/path/to/repo']);

    expect(result.collectionSource).toStrictEqual({
      path: '/path/to/repo/.preflight/collections/default.js',
    });
  });

  it('resolves --local with --collection to a named .js file', () => {
    const result = parseRunArgs(['--local', '/path/to/repo', '--collection', 'deploy']);

    expect(result.collectionSource).toStrictEqual({
      path: '/path/to/repo/.preflight/collections/deploy.js',
    });
  });

  it('parses -l as short form of --local', () => {
    const result = parseRunArgs(['-l', '/path/to/repo']);

    expect(result.collectionSource).toStrictEqual({
      path: '/path/to/repo/.preflight/collections/default.js',
    });
  });

  it('resolves --local with a relative path against cwd', () => {
    const result = parseRunArgs(['--local', '../sibling-repo']);
    const expected = path.resolve(process.cwd(), '../sibling-repo');

    expect(result.collectionSource).toStrictEqual({
      path: `${expected}/.preflight/collections/default.js`,
    });
  });

  it('throws when --local has no value', () => {
    expect(() => parseRunArgs(['--local'])).toThrow('--local requires a path to a local repository');
  });

  // Mutual exclusivity
  it('throws when --file and --github are combined', () => {
    expect(() => parseRunArgs(['--file', 'path.ts', '--github', 'org/repo'])).toThrow(
      'Cannot combine --file, --github, --local, and --url flags',
    );
  });

  it('throws when --github and --file are combined (reverse order)', () => {
    expect(() => parseRunArgs(['--github', 'org/repo', '--file', 'path.ts'])).toThrow(
      'Cannot combine --file, --github, --local, and --url flags',
    );
  });

  it('throws when --file and --url are combined', () => {
    expect(() => parseRunArgs(['--file', 'path.ts', '--url', 'https://example.com/config.js'])).toThrow(
      'Cannot combine --file, --github, --local, and --url flags',
    );
  });

  it('throws when a flag name is passed as value to another flag', () => {
    expect(() => parseRunArgs(['--github', '--url'])).toThrow('--github requires a repository argument');
    expect(() => parseRunArgs(['--url', '--github'])).toThrow('--url requires a URL argument');
    expect(() => parseRunArgs(['--file', '--github'])).toThrow('--file requires a path argument');
  });

  it('throws when --github and --url are combined', () => {
    expect(() => parseRunArgs(['--github', 'org/repo', '--url', 'https://example.com/config.js'])).toThrow(
      'Cannot combine --file, --github, --local, and --url flags',
    );
  });

  it('throws when --local and --file are combined', () => {
    expect(() => parseRunArgs(['--file', 'path.ts', '--local', '/other/repo'])).toThrow(
      'Cannot combine --file, --github, --local, and --url flags',
    );
  });

  it('throws when --local and --url are combined', () => {
    expect(() => parseRunArgs(['--local', '/other/repo', '--url', 'https://example.com/config.js'])).toThrow(
      'Cannot combine --file, --github, --local, and --url flags',
    );
  });

  it('throws when --github and --local are combined', () => {
    expect(() => parseRunArgs(['--github', 'org/repo', '--local', '/path'])).toThrow(
      'Cannot combine --file, --github, --local, and --url flags',
    );
  });

  it('throws when --collection is combined with --file', () => {
    expect(() => parseRunArgs(['--file', 'path.ts', '--collection', 'deploy'])).toThrow(
      '--collection cannot be used with --file',
    );
  });

  it('throws when --collection is combined with --url', () => {
    expect(() => parseRunArgs(['--url', 'https://example.com/config.js', '--collection', 'deploy'])).toThrow(
      '--collection cannot be used with --url',
    );
  });

  // --fail-on flag
  it('parses --fail-on with valid severity', () => {
    const result = parseRunArgs(['--fail-on', 'warn']);

    expect(result.failOn).toBe('warn');
  });

  it('parses --fail-on= syntax', () => {
    const result = parseRunArgs(['--fail-on=recommend']);

    expect(result.failOn).toBe('recommend');
  });

  it('throws when --fail-on has an invalid value', () => {
    expect(() => parseRunArgs(['--fail-on', 'critical'])).toThrow(
      '--fail-on must be one of: error, warn, recommend (got "critical")',
    );
  });

  it('throws when --fail-on has no value', () => {
    expect(() => parseRunArgs(['--fail-on'])).toThrow('--fail-on requires a severity level');
  });

  // --report-on flag
  it('parses --report-on with valid severity', () => {
    const result = parseRunArgs(['--report-on', 'error']);

    expect(result.reportOn).toBe('error');
  });

  it('parses --report-on= syntax', () => {
    const result = parseRunArgs(['--report-on=warn']);

    expect(result.reportOn).toBe('warn');
  });

  it('throws when --report-on has an invalid value', () => {
    expect(() => parseRunArgs(['--report-on', 'debug'])).toThrow(
      '--report-on must be one of: error, warn, recommend (got "debug")',
    );
  });

  it('throws when --report-on has no value', () => {
    expect(() => parseRunArgs(['--report-on'])).toThrow('--report-on requires a severity level');
  });

  it('omits failOn and reportOn when not specified', () => {
    const result = parseRunArgs([]);

    expect(result).not.toHaveProperty('failOn');
    expect(result).not.toHaveProperty('reportOn');
  });
});

describe(runCommand, () => {
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockReportPreflight.mockReturnValue('report output');
    mockFormatCombinedSummary.mockReturnValue('combined summary');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockLoadPreflightCollection.mockReset();
    mockRunPreflight.mockReset();
    mockReportPreflight.mockReset();
    mockFormatCombinedSummary.mockReset();
    mockFormatJsonReport.mockReset();
    mockFormatJsonError.mockReset();
    mockResolveGitHubToken.mockReset();
    mockLoadRemoteCollection.mockReset();
  });

  it('runs all checklists when no names are given', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(mockRunPreflight).toHaveBeenCalledTimes(2);
    expect(exitCode).toBe(0);
  });

  it('filters to named checklists only', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({
      names: ['deploy'],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(mockRunPreflight).toHaveBeenCalledTimes(1);
    expect(mockRunPreflight).toHaveBeenCalledWith(
      collection.checklists[0],
      expect.objectContaining({ defaultSeverity: 'error', failOn: 'error' }),
    );
    expect(exitCode).toBe(0);
  });

  it('errors when an unknown checklist name is given', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);

    const exitCode = await runCommand({
      names: ['nonexistent'],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown name(s): nonexistent'));
    expect(exitCode).toBe(1);
  });

  it('returns exit code 1 when any checklist fails', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight
      .mockResolvedValueOnce({ results: [], passed: true, durationMs: 0 })
      .mockResolvedValueOnce({ results: [], passed: false, durationMs: 0 });

    const exitCode = await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(exitCode).toBe(1);
  });

  it('passes collection path to local collection loader', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: [],
      collectionSource: { path: 'custom/path.ts' },
      json: false,
    });

    expect(mockLoadPreflightCollection).toHaveBeenCalledWith('custom/path.ts');
  });

  it('shows headers when running multiple checklists', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allOutput).toContain('--- deploy ---');
    expect(allOutput).toContain('--- infra ---');
  });

  it('does not show headers for a single checklist', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: ['deploy'],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allOutput).not.toContain('---');
  });

  it('uses per-checklist fixLocation over collection default', async () => {
    const collection = makeCollection({
      fixLocation: 'end',
      checklists: [{ name: 'deploy', checks: [{ name: 'a', check: () => true }], fixLocation: 'inline' }],
    });
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(mockReportPreflight).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fixLocation: 'inline' }),
    );
  });

  it('falls back to collection-level fixLocation when checklist has none', async () => {
    const collection = makeCollection({
      fixLocation: 'end',
      checklists: [{ name: 'deploy', checks: [{ name: 'a', check: () => true }] }],
    });
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(mockReportPreflight).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fixLocation: 'end' }),
    );
  });

  it('reports collection loading errors to stderr', async () => {
    mockLoadPreflightCollection.mockRejectedValue(new Error('Collection not found'));

    const exitCode = await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(stderrSpy).toHaveBeenCalledWith('Error: Collection not found\n');
    expect(exitCode).toBe(1);
  });

  it('prints combined summary when multiple checklists run', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({
      results: [
        {
          name: 'a',
          status: 'passed',
          ok: true,
          severity: 'error',
          detail: null,
          fix: null,
          error: null,
          progress: null,
          durationMs: 10,
        },
      ],
      passed: true,
      durationMs: 10,
    });

    await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(mockFormatCombinedSummary).toHaveBeenCalledTimes(1);
    expect(mockFormatCombinedSummary).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'deploy', passed: 1, failed: 0, skipped: 0, allPassed: true }),
      expect.objectContaining({ name: 'infra', passed: 1, failed: 0, skipped: 0, allPassed: true }),
    ]);
  });

  it('does not print combined summary for a single checklist', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: ['deploy'],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(mockFormatCombinedSummary).not.toHaveBeenCalled();
  });

  it('includes failure counts in combined summary', async () => {
    const collection = makeCollection();
    mockLoadPreflightCollection.mockResolvedValue(collection);
    mockRunPreflight
      .mockResolvedValueOnce({
        results: [
          {
            name: 'a',
            status: 'passed',
            ok: true,
            severity: 'error',
            detail: null,
            fix: null,
            error: null,
            progress: null,
            durationMs: 10,
          },
          {
            name: 'b',
            status: 'failed',
            ok: false,
            severity: 'error',
            detail: null,
            fix: null,
            error: null,
            progress: null,
            durationMs: 5,
          },
        ],
        passed: false,
        durationMs: 15,
      })
      .mockResolvedValueOnce({
        results: [
          {
            name: 'c',
            status: 'skipped',
            ok: null,
            severity: 'error',
            skipReason: 'precondition',
            detail: null,
            fix: null,
            error: null,
            progress: null,
            durationMs: 0,
          },
        ],
        passed: false,
        durationMs: 0,
      });

    await runCommand({
      names: [],
      collectionSource: { path: '.preflight/collections/default.ts' },
      json: false,
    });

    expect(mockFormatCombinedSummary).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'deploy', passed: 1, failed: 1, skipped: 0, allPassed: false }),
      expect.objectContaining({ name: 'infra', passed: 0, failed: 0, skipped: 1, allPassed: false }),
    ]);
  });

  describe('threshold cascade', () => {
    it('uses CLI --fail-on flag over collection default', async () => {
      const collection = makeCollection({ failOn: 'error' });
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      await runCommand({
        names: ['deploy'],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: false,
        failOn: 'warn',
      });

      expect(mockRunPreflight).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failOn: 'warn' }));
    });

    it('falls back to collection failOn when CLI flag is absent', async () => {
      const collection = makeCollection({ failOn: 'recommend' });
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      await runCommand({
        names: ['deploy'],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: false,
      });

      expect(mockRunPreflight).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ failOn: 'recommend' }),
      );
    });

    it('falls back to collection reportOn when CLI flag is absent', async () => {
      const collection = makeCollection({ reportOn: 'warn' });
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      await runCommand({
        names: ['deploy'],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: false,
      });

      expect(mockReportPreflight).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reportOn: 'warn' }),
      );
    });

    it('passes reportOn to reportPreflight', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      await runCommand({
        names: ['deploy'],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: false,
        reportOn: 'warn',
      });

      expect(mockReportPreflight).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reportOn: 'warn' }),
      );
    });

    it('passes reportOn to formatJsonReport', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });
      mockFormatJsonReport.mockReturnValue('{"allPassed":true}');

      await runCommand({
        names: ['deploy'],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
        reportOn: 'error',
      });

      expect(mockFormatJsonReport).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reportOn: 'error' }),
      );
    });
  });

  describe('JSON mode', () => {
    beforeEach(() => {
      mockFormatJsonReport.mockReturnValue('{"allPassed":true}');
      mockFormatJsonError.mockReturnValue('{"error":"boom"}');
    });

    it('emits JSON output and no human-readable text', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      const exitCode = await runCommand({
        names: [],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
      });

      expect(mockFormatJsonReport).toHaveBeenCalledTimes(1);
      expect(mockReportPreflight).not.toHaveBeenCalled();
      expect(mockFormatCombinedSummary).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('{"allPassed":true}\n');
      expect(exitCode).toBe(0);
    });

    it('returns exit code 1 when any checklist fails in JSON mode', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight
        .mockResolvedValueOnce({ results: [], passed: true, durationMs: 0 })
        .mockResolvedValueOnce({ results: [], passed: false, durationMs: 0 });

      const exitCode = await runCommand({
        names: [],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
      });

      expect(exitCode).toBe(1);
    });

    it('emits JSON error to stdout for collection loading errors', async () => {
      mockLoadPreflightCollection.mockRejectedValue(new Error('Collection not found'));

      const exitCode = await runCommand({
        names: [],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
      });

      expect(mockFormatJsonError).toHaveBeenCalledWith('Collection not found');
      expect(stdoutSpy).toHaveBeenCalledWith('{"error":"boom"}\n');
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('emits JSON error to stdout for unknown checklist names', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);

      const exitCode = await runCommand({
        names: ['nonexistent'],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
      });

      expect(mockFormatJsonError).toHaveBeenCalledWith(expect.stringContaining('Unknown name(s): nonexistent'));
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('passes checklist name-report pairs to formatJsonReport', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);
      const report1 = { results: [], passed: true, durationMs: 10 };
      const report2 = { results: [], passed: true, durationMs: 20 };
      mockRunPreflight.mockResolvedValueOnce(report1).mockResolvedValueOnce(report2);

      await runCommand({
        names: [],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
      });

      expect(mockFormatJsonReport).toHaveBeenCalledWith(
        [
          { name: 'deploy', report: report1 },
          { name: 'infra', report: report2 },
        ],
        expect.objectContaining({ reportOn: 'recommend' }),
      );
    });

    it('emits JSON error to stdout when runPreflight throws', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockRejectedValue(new Error('runner crashed'));

      const exitCode = await runCommand({
        names: ['deploy'],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
      });

      expect(mockFormatJsonError).toHaveBeenCalledWith('runner crashed');
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('does not write headers in JSON mode', async () => {
      const collection = makeCollection();
      mockLoadPreflightCollection.mockResolvedValue(collection);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      await runCommand({
        names: [],
        collectionSource: { path: '.preflight/collections/default.ts' },
        json: true,
      });

      const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(allOutput).not.toContain('---');
    });
  });

  // GitHub source tests (via URL with raw.githubusercontent.com)
  it('resolves token for GitHub raw URLs', async () => {
    const collection = makeCollection();
    mockResolveGitHubToken.mockReturnValue('token-abc');
    mockLoadRemoteCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({
      names: [],
      collectionSource: { url: 'https://raw.githubusercontent.com/org/repo/main/.preflight/collections/nmr.js' },
      json: false,
    });

    expect(mockResolveGitHubToken).toHaveBeenCalled();
    expect(mockLoadRemoteCollection).toHaveBeenCalledWith({
      url: 'https://raw.githubusercontent.com/org/repo/main/.preflight/collections/nmr.js',
      token: 'token-abc',
    });
    expect(exitCode).toBe(0);
  });

  it('omits token when resolveGitHubToken returns undefined for GitHub URLs', async () => {
    const collection = makeCollection();
    mockResolveGitHubToken.mockReturnValue(undefined);
    mockLoadRemoteCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: [],
      collectionSource: { url: 'https://raw.githubusercontent.com/org/repo/v2/.preflight/collections/nmr.js' },
      json: false,
    });

    expect(mockLoadRemoteCollection).toHaveBeenCalledWith({
      url: 'https://raw.githubusercontent.com/org/repo/v2/.preflight/collections/nmr.js',
    });
    expect(mockLoadRemoteCollection.mock.calls[0][0]).not.toHaveProperty('token');
  });

  // URL source tests
  it('fetches directly for non-GitHub URL source without token resolution', async () => {
    const collection = makeCollection();
    mockLoadRemoteCollection.mockResolvedValue(collection);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({
      names: [],
      collectionSource: { url: 'https://example.com/config.js' },
      json: false,
    });

    expect(mockResolveGitHubToken).not.toHaveBeenCalled();
    expect(mockLoadRemoteCollection).toHaveBeenCalledWith({
      url: 'https://example.com/config.js',
    });
    expect(exitCode).toBe(0);
  });

  it('reports remote collection loading errors to stderr', async () => {
    mockLoadRemoteCollection.mockRejectedValue(new Error('Failed to fetch remote collection'));

    const exitCode = await runCommand({
      names: [],
      collectionSource: { url: 'https://example.com/config.js' },
      json: false,
    });

    expect(stderrSpy).toHaveBeenCalledWith('Error: Failed to fetch remote collection\n');
    expect(exitCode).toBe(1);
  });
});
