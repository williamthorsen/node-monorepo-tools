import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { PreflightConfig } from '../src/types.ts';

const mockLoadPreflightConfig = vi.hoisted(() => vi.fn());
const mockRunPreflight = vi.hoisted(() => vi.fn());
const mockReportPreflight = vi.hoisted(() => vi.fn());
const mockFormatCombinedSummary = vi.hoisted(() => vi.fn());
const mockFormatJsonReport = vi.hoisted(() => vi.fn());
const mockFormatJsonError = vi.hoisted(() => vi.fn());
const mockExpandGitHubShorthand = vi.hoisted(() => vi.fn());
const mockResolveGitHubToken = vi.hoisted(() => vi.fn());
const mockLoadRemoteConfig = vi.hoisted(() => vi.fn());

vi.mock('../src/config.ts', () => ({
  loadPreflightConfig: mockLoadPreflightConfig,
}));

vi.mock('../src/runPreflight.ts', () => ({
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

vi.mock('../src/expandGitHubShorthand.ts', () => ({
  expandGitHubShorthand: mockExpandGitHubShorthand,
}));

vi.mock('../src/resolveGitHubToken.ts', () => ({
  resolveGitHubToken: mockResolveGitHubToken,
}));

vi.mock('../src/loadRemoteConfig.ts', () => ({
  loadRemoteConfig: mockLoadRemoteConfig,
}));

import { parseRunArgs, runCommand } from '../src/cli.ts';

function makeConfig(overrides?: Partial<PreflightConfig>): PreflightConfig {
  return {
    checklists: [
      { name: 'deploy', checks: [{ name: 'a', check: () => true }] },
      { name: 'infra', checks: [{ name: 'b', check: () => true }] },
    ],
    ...overrides,
  };
}

describe(parseRunArgs, () => {
  it('parses positional names with default local source', () => {
    const result = parseRunArgs(['deploy', 'infra']);

    expect(result.names).toStrictEqual(['deploy', 'infra']);
    expect(result.configSource).toStrictEqual({ type: 'local' });
  });

  it('parses --config flag', () => {
    const result = parseRunArgs(['--config', 'custom/path.ts']);

    expect(result.configSource).toStrictEqual({ type: 'local', path: 'custom/path.ts' });
    expect(result.names).toStrictEqual([]);
  });

  it('parses --config= syntax', () => {
    const result = parseRunArgs(['--config=custom/path.ts']);

    expect(result.configSource).toStrictEqual({ type: 'local', path: 'custom/path.ts' });
  });

  it('parses -c flag', () => {
    const result = parseRunArgs(['-c', 'custom/path.ts']);

    expect(result.configSource).toStrictEqual({ type: 'local', path: 'custom/path.ts' });
  });

  it('parses mixed flags and names', () => {
    const result = parseRunArgs(['-c', 'config.ts', 'deploy']);

    expect(result.configSource).toStrictEqual({ type: 'local', path: 'config.ts' });
    expect(result.names).toStrictEqual(['deploy']);
  });

  it('throws when --config has no value', () => {
    expect(() => parseRunArgs(['--config'])).toThrow('--config requires a path argument');
  });

  it('throws when -c has no value', () => {
    expect(() => parseRunArgs(['-c'])).toThrow('--config requires a path argument');
  });

  it('throws when --config= has an empty value', () => {
    expect(() => parseRunArgs(['--config='])).toThrow('--config requires a path argument');
  });

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

  it('defaults json to false', () => {
    const result = parseRunArgs([]);

    expect(result.json).toBe(false);
  });

  it('parses --json combined with --config and positional names', () => {
    const result = parseRunArgs(['--json', '--config', '/path/to/config', 'deploy']);

    expect(result.json).toBe(true);
    expect(result.configSource).toStrictEqual({ type: 'local', path: '/path/to/config' });
    expect(result.names).toStrictEqual(['deploy']);
  });

  it('throws on unknown flags', () => {
    expect(() => parseRunArgs(['--unknown'])).toThrow("unknown flag '--unknown'");
  });

  // --github flag
  it('parses --github flag with space-separated value', () => {
    const result = parseRunArgs(['--github', 'org/repo/path.js@v1']);

    expect(result.configSource).toStrictEqual({ type: 'github', shorthand: 'org/repo/path.js@v1' });
  });

  it('parses --github= syntax', () => {
    const result = parseRunArgs(['--github=org/repo/path.js']);

    expect(result.configSource).toStrictEqual({ type: 'github', shorthand: 'org/repo/path.js' });
  });

  it('throws when --github has no value', () => {
    expect(() => parseRunArgs(['--github'])).toThrow('--github requires a shorthand argument');
  });

  it('throws when --github= has an empty value', () => {
    expect(() => parseRunArgs(['--github='])).toThrow('--github requires a shorthand argument');
  });

  // --url flag
  it('parses --url flag with space-separated value', () => {
    const result = parseRunArgs(['--url', 'https://example.com/config.js']);

    expect(result.configSource).toStrictEqual({ type: 'url', url: 'https://example.com/config.js' });
  });

  it('parses --url= syntax', () => {
    const result = parseRunArgs(['--url=https://example.com/config.js']);

    expect(result.configSource).toStrictEqual({ type: 'url', url: 'https://example.com/config.js' });
  });

  it('throws when --url has no value', () => {
    expect(() => parseRunArgs(['--url'])).toThrow('--url requires a URL argument');
  });

  it('throws when --url= has an empty value', () => {
    expect(() => parseRunArgs(['--url='])).toThrow('--url requires a URL argument');
  });

  // Mutual exclusivity
  it('throws when --config and --github are combined', () => {
    expect(() => parseRunArgs(['--config', 'path.ts', '--github', 'org/repo/path.js'])).toThrow(
      'Cannot combine --config, --github, and --url flags',
    );
  });

  it('throws when --config and --url are combined', () => {
    expect(() => parseRunArgs(['--config', 'path.ts', '--url', 'https://example.com/config.js'])).toThrow(
      'Cannot combine --config, --github, and --url flags',
    );
  });

  it('throws when a flag name is passed as value to another flag', () => {
    expect(() => parseRunArgs(['--github', '--url'])).toThrow('--github requires a shorthand argument');
    expect(() => parseRunArgs(['--url', '--github'])).toThrow('--url requires a URL argument');
    expect(() => parseRunArgs(['--config', '--github'])).toThrow('--config requires a path argument');
  });

  it('throws when --github and --url are combined', () => {
    expect(() => parseRunArgs(['--github', 'org/repo/path.js', '--url', 'https://example.com/config.js'])).toThrow(
      'Cannot combine --config, --github, and --url flags',
    );
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
    mockLoadPreflightConfig.mockReset();
    mockRunPreflight.mockReset();
    mockReportPreflight.mockReset();
    mockFormatCombinedSummary.mockReset();
    mockFormatJsonReport.mockReset();
    mockFormatJsonError.mockReset();
    mockExpandGitHubShorthand.mockReset();
    mockResolveGitHubToken.mockReset();
    mockLoadRemoteConfig.mockReset();
  });

  it('runs all checklists when no names are given', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    expect(mockRunPreflight).toHaveBeenCalledTimes(2);
    expect(exitCode).toBe(0);
  });

  it('filters to named checklists only', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({ names: ['deploy'], configSource: { type: 'local' }, json: false });

    expect(mockRunPreflight).toHaveBeenCalledTimes(1);
    expect(mockRunPreflight).toHaveBeenCalledWith(config.checklists[0]);
    expect(exitCode).toBe(0);
  });

  it('errors when an unknown checklist name is given', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);

    const exitCode = await runCommand({ names: ['nonexistent'], configSource: { type: 'local' }, json: false });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('unknown checklist(s): nonexistent'));
    expect(exitCode).toBe(1);
  });

  it('returns exit code 1 when any checklist fails', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight
      .mockResolvedValueOnce({ results: [], passed: true, durationMs: 0 })
      .mockResolvedValueOnce({ results: [], passed: false, durationMs: 0 });

    const exitCode = await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    expect(exitCode).toBe(1);
  });

  it('passes config path to local config loader', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: [], configSource: { type: 'local', path: 'custom/path.ts' }, json: false });

    expect(mockLoadPreflightConfig).toHaveBeenCalledWith('custom/path.ts');
  });

  it('shows headers when running multiple checklists', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allOutput).toContain('--- deploy ---');
    expect(allOutput).toContain('--- infra ---');
  });

  it('does not show headers for a single checklist', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: ['deploy'], configSource: { type: 'local' }, json: false });

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allOutput).not.toContain('---');
  });

  it('uses per-checklist fixLocation over config default', async () => {
    const config = makeConfig({
      fixLocation: 'END',
      checklists: [{ name: 'deploy', checks: [{ name: 'a', check: () => true }], fixLocation: 'INLINE' }],
    });
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    expect(mockReportPreflight).toHaveBeenCalledWith(expect.anything(), { fixLocation: 'INLINE' });
  });

  it('falls back to config-level fixLocation when checklist has none', async () => {
    const config = makeConfig({
      fixLocation: 'END',
      checklists: [{ name: 'deploy', checks: [{ name: 'a', check: () => true }] }],
    });
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    expect(mockReportPreflight).toHaveBeenCalledWith(expect.anything(), { fixLocation: 'END' });
  });

  it('reports config loading errors to stderr', async () => {
    mockLoadPreflightConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    expect(stderrSpy).toHaveBeenCalledWith('Error: Config not found\n');
    expect(exitCode).toBe(1);
  });

  it('prints combined summary when multiple checklists run', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({
      results: [{ name: 'a', status: 'passed', durationMs: 10 }],
      passed: true,
      durationMs: 10,
    });

    await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    expect(mockFormatCombinedSummary).toHaveBeenCalledTimes(1);
    expect(mockFormatCombinedSummary).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'deploy', passed: 1, failed: 0, skipped: 0, allPassed: true }),
      expect.objectContaining({ name: 'infra', passed: 1, failed: 0, skipped: 0, allPassed: true }),
    ]);
  });

  it('does not print combined summary for a single checklist', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: ['deploy'], configSource: { type: 'local' }, json: false });

    expect(mockFormatCombinedSummary).not.toHaveBeenCalled();
  });

  it('includes failure counts in combined summary', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight
      .mockResolvedValueOnce({
        results: [
          { name: 'a', status: 'passed', durationMs: 10 },
          { name: 'b', status: 'failed', durationMs: 5 },
        ],
        passed: false,
        durationMs: 15,
      })
      .mockResolvedValueOnce({
        results: [{ name: 'c', status: 'skipped', durationMs: 0 }],
        passed: false,
        durationMs: 0,
      });

    await runCommand({ names: [], configSource: { type: 'local' }, json: false });

    expect(mockFormatCombinedSummary).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'deploy', passed: 1, failed: 1, skipped: 0, allPassed: false }),
      expect.objectContaining({ name: 'infra', passed: 0, failed: 0, skipped: 1, allPassed: false }),
    ]);
  });

  describe('JSON mode', () => {
    beforeEach(() => {
      mockFormatJsonReport.mockReturnValue('{"allPassed":true}');
      mockFormatJsonError.mockReturnValue('{"error":"boom"}');
    });

    it('emits JSON output and no human-readable text', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      const exitCode = await runCommand({ names: [], configSource: { type: 'local' }, json: true });

      expect(mockFormatJsonReport).toHaveBeenCalledTimes(1);
      expect(mockReportPreflight).not.toHaveBeenCalled();
      expect(mockFormatCombinedSummary).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('{"allPassed":true}\n');
      expect(exitCode).toBe(0);
    });

    it('returns exit code 1 when any checklist fails in JSON mode', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);
      mockRunPreflight
        .mockResolvedValueOnce({ results: [], passed: true, durationMs: 0 })
        .mockResolvedValueOnce({ results: [], passed: false, durationMs: 0 });

      const exitCode = await runCommand({ names: [], configSource: { type: 'local' }, json: true });

      expect(exitCode).toBe(1);
    });

    it('emits JSON error to stdout for config loading errors', async () => {
      mockLoadPreflightConfig.mockRejectedValue(new Error('Config not found'));

      const exitCode = await runCommand({ names: [], configSource: { type: 'local' }, json: true });

      expect(mockFormatJsonError).toHaveBeenCalledWith('Config not found');
      expect(stdoutSpy).toHaveBeenCalledWith('{"error":"boom"}\n');
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('emits JSON error to stdout for unknown checklist names', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);

      const exitCode = await runCommand({ names: ['nonexistent'], configSource: { type: 'local' }, json: true });

      expect(mockFormatJsonError).toHaveBeenCalledWith(expect.stringContaining('unknown checklist(s): nonexistent'));
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('passes checklist name-report pairs to formatJsonReport', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);
      const report1 = { results: [], passed: true, durationMs: 10 };
      const report2 = { results: [], passed: true, durationMs: 20 };
      mockRunPreflight.mockResolvedValueOnce(report1).mockResolvedValueOnce(report2);

      await runCommand({ names: [], configSource: { type: 'local' }, json: true });

      expect(mockFormatJsonReport).toHaveBeenCalledWith([
        { name: 'deploy', report: report1 },
        { name: 'infra', report: report2 },
      ]);
    });

    it('emits JSON error to stdout when runPreflight throws', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);
      mockRunPreflight.mockRejectedValue(new Error('runner crashed'));

      const exitCode = await runCommand({ names: ['deploy'], configSource: { type: 'local' }, json: true });

      expect(mockFormatJsonError).toHaveBeenCalledWith('runner crashed');
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('does not write headers in JSON mode', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      await runCommand({ names: [], configSource: { type: 'local' }, json: true });

      const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(allOutput).not.toContain('---');
    });
  });

  // GitHub source tests
  it('expands shorthand and resolves token for --github source', async () => {
    const config = makeConfig();
    mockExpandGitHubShorthand.mockReturnValue('https://raw.githubusercontent.com/org/repo/main/config.js');
    mockResolveGitHubToken.mockReturnValue('token-abc');
    mockLoadRemoteConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({
      names: [],
      configSource: { type: 'github', shorthand: 'org/repo/config.js' },
      json: false,
    });

    expect(mockExpandGitHubShorthand).toHaveBeenCalledWith('org/repo/config.js');
    expect(mockResolveGitHubToken).toHaveBeenCalled();
    expect(mockLoadRemoteConfig).toHaveBeenCalledWith({
      url: 'https://raw.githubusercontent.com/org/repo/main/config.js',
      token: 'token-abc',
    });
    expect(exitCode).toBe(0);
  });

  it('omits token when resolveGitHubToken returns undefined for --github source', async () => {
    const config = makeConfig();
    mockExpandGitHubShorthand.mockReturnValue('https://raw.githubusercontent.com/org/repo/main/config.js');
    mockResolveGitHubToken.mockReturnValue(undefined);
    mockLoadRemoteConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({
      names: [],
      configSource: { type: 'github', shorthand: 'org/repo/config.js' },
      json: false,
    });

    expect(mockLoadRemoteConfig).toHaveBeenCalledWith({
      url: 'https://raw.githubusercontent.com/org/repo/main/config.js',
    });
    expect(mockLoadRemoteConfig.mock.calls[0][0]).not.toHaveProperty('token');
  });

  // URL source tests
  it('fetches directly for --url source without token resolution', async () => {
    const config = makeConfig();
    mockLoadRemoteConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({
      names: [],
      configSource: { type: 'url', url: 'https://example.com/config.js' },
      json: false,
    });

    expect(mockResolveGitHubToken).not.toHaveBeenCalled();
    expect(mockLoadRemoteConfig).toHaveBeenCalledWith({
      url: 'https://example.com/config.js',
    });
    expect(exitCode).toBe(0);
  });

  it('reports remote config loading errors to stderr', async () => {
    mockLoadRemoteConfig.mockRejectedValue(new Error('Failed to fetch remote config'));

    const exitCode = await runCommand({
      names: [],
      configSource: { type: 'url', url: 'https://example.com/config.js' },
      json: false,
    });

    expect(stderrSpy).toHaveBeenCalledWith('Error: Failed to fetch remote config\n');
    expect(exitCode).toBe(1);
  });
});
