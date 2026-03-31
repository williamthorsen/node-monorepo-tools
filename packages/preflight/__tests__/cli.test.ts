import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { PreflightConfig } from '../src/types.ts';

const mockLoadPreflightConfig = vi.hoisted(() => vi.fn());
const mockRunPreflight = vi.hoisted(() => vi.fn());
const mockReportPreflight = vi.hoisted(() => vi.fn());
const mockFormatCombinedSummary = vi.hoisted(() => vi.fn());
const mockFormatJsonReport = vi.hoisted(() => vi.fn());
const mockFormatJsonError = vi.hoisted(() => vi.fn());

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
  it('parses positional names', () => {
    const result = parseRunArgs(['deploy', 'infra']);

    expect(result.names).toStrictEqual(['deploy', 'infra']);
    expect(result.configPath).toBeUndefined();
  });

  it('parses --config flag', () => {
    const result = parseRunArgs(['--config', 'custom/path.ts']);

    expect(result.configPath).toBe('custom/path.ts');
    expect(result.names).toStrictEqual([]);
  });

  it('parses --config= syntax', () => {
    const result = parseRunArgs(['--config=custom/path.ts']);

    expect(result.configPath).toBe('custom/path.ts');
  });

  it('parses -c flag', () => {
    const result = parseRunArgs(['-c', 'custom/path.ts']);

    expect(result.configPath).toBe('custom/path.ts');
  });

  it('parses mixed flags and names', () => {
    const result = parseRunArgs(['-c', 'config.ts', 'deploy']);

    expect(result.configPath).toBe('config.ts');
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
    expect(result.configPath).toBe('/path/to/config');
    expect(result.names).toStrictEqual(['deploy']);
  });

  it('throws on unknown flags', () => {
    expect(() => parseRunArgs(['--unknown'])).toThrow("unknown flag '--unknown'");
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
  });

  it('runs all checklists when no names are given', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({ names: [] });

    expect(mockRunPreflight).toHaveBeenCalledTimes(2);
    expect(exitCode).toBe(0);
  });

  it('filters to named checklists only', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    const exitCode = await runCommand({ names: ['deploy'] });

    expect(mockRunPreflight).toHaveBeenCalledTimes(1);
    expect(mockRunPreflight).toHaveBeenCalledWith(config.checklists[0]);
    expect(exitCode).toBe(0);
  });

  it('errors when an unknown checklist name is given', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);

    const exitCode = await runCommand({ names: ['nonexistent'] });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('unknown checklist(s): nonexistent'));
    expect(exitCode).toBe(1);
  });

  it('returns exit code 1 when any checklist fails', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight
      .mockResolvedValueOnce({ results: [], passed: true, durationMs: 0 })
      .mockResolvedValueOnce({ results: [], passed: false, durationMs: 0 });

    const exitCode = await runCommand({ names: [] });

    expect(exitCode).toBe(1);
  });

  it('passes configPath to config loader', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: [], configPath: 'custom/path.ts' });

    expect(mockLoadPreflightConfig).toHaveBeenCalledWith('custom/path.ts');
  });

  it('shows headers when running multiple checklists', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: [] });

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allOutput).toContain('--- deploy ---');
    expect(allOutput).toContain('--- infra ---');
  });

  it('does not show headers for a single checklist', async () => {
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: ['deploy'] });

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

    await runCommand({ names: [] });

    expect(mockReportPreflight).toHaveBeenCalledWith(expect.anything(), { fixLocation: 'INLINE' });
  });

  it('falls back to config-level fixLocation when checklist has none', async () => {
    const config = makeConfig({
      fixLocation: 'END',
      checklists: [{ name: 'deploy', checks: [{ name: 'a', check: () => true }] }],
    });
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runCommand({ names: [] });

    expect(mockReportPreflight).toHaveBeenCalledWith(expect.anything(), { fixLocation: 'END' });
  });

  it('reports config loading errors to stderr', async () => {
    mockLoadPreflightConfig.mockRejectedValue(new Error('Config not found'));

    const exitCode = await runCommand({ names: [] });

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

    await runCommand({ names: [] });

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

    await runCommand({ names: ['deploy'] });

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

    await runCommand({ names: [] });

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

      const exitCode = await runCommand({ names: [], json: true });

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

      const exitCode = await runCommand({ names: [], json: true });

      expect(exitCode).toBe(1);
    });

    it('emits JSON error to stdout for config loading errors', async () => {
      mockLoadPreflightConfig.mockRejectedValue(new Error('Config not found'));

      const exitCode = await runCommand({ names: [], json: true });

      expect(mockFormatJsonError).toHaveBeenCalledWith('Config not found');
      expect(stdoutSpy).toHaveBeenCalledWith('{"error":"boom"}\n');
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('emits JSON error to stdout for unknown checklist names', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);

      const exitCode = await runCommand({ names: ['nonexistent'], json: true });

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

      await runCommand({ names: [], json: true });

      expect(mockFormatJsonReport).toHaveBeenCalledWith([
        { name: 'deploy', report: report1 },
        { name: 'infra', report: report2 },
      ]);
    });

    it('emits JSON error to stdout when runPreflight throws', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);
      mockRunPreflight.mockRejectedValue(new Error('runner crashed'));

      const exitCode = await runCommand({ names: ['deploy'], json: true });

      expect(mockFormatJsonError).toHaveBeenCalledWith('runner crashed');
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(exitCode).toBe(1);
    });

    it('does not write headers in JSON mode', async () => {
      const config = makeConfig();
      mockLoadPreflightConfig.mockResolvedValue(config);
      mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

      await runCommand({ names: [], json: true });

      const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(allOutput).not.toContain('---');
    });
  });
});
