import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import type { PreflightConfig } from '../src/types.ts';

const mockLoadPreflightConfig = vi.hoisted(() => vi.fn());
const mockRunPreflight = vi.hoisted(() => vi.fn());
const mockReportPreflight = vi.hoisted(() => vi.fn());

vi.mock('../src/config.ts', () => ({
  loadPreflightConfig: mockLoadPreflightConfig,
}));

vi.mock('../src/runPreflight.ts', () => ({
  runPreflight: mockRunPreflight,
}));

vi.mock('../src/reportPreflight.ts', () => ({
  reportPreflight: mockReportPreflight,
}));

import { main, parseArgs } from '../src/cli.ts';

/** Sentinel error thrown by the mocked `process.exit` so tests can detect early termination. */
class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

function makeConfig(overrides?: Partial<PreflightConfig>): PreflightConfig {
  return {
    checklists: [
      { name: 'deploy', checks: [{ name: 'a', check: () => true }] },
      { name: 'infra', checks: [{ name: 'b', check: () => true }] },
    ],
    ...overrides,
  };
}

describe(parseArgs, () => {
  it('parses positional names', () => {
    const result = parseArgs(['node', 'preflight', 'deploy', 'infra']);

    expect(result.names).toStrictEqual(['deploy', 'infra']);
    expect(result.configPath).toBeUndefined();
  });

  it('parses --config flag', () => {
    const result = parseArgs(['node', 'preflight', '--config', 'custom/path.ts']);

    expect(result.configPath).toBe('custom/path.ts');
    expect(result.names).toStrictEqual([]);
  });

  it('parses --config= syntax', () => {
    const result = parseArgs(['node', 'preflight', '--config=custom/path.ts']);

    expect(result.configPath).toBe('custom/path.ts');
  });

  it('parses -c flag', () => {
    const result = parseArgs(['node', 'preflight', '-c', 'custom/path.ts']);

    expect(result.configPath).toBe('custom/path.ts');
  });

  it('parses mixed flags and names', () => {
    const result = parseArgs(['node', 'preflight', '-c', 'config.ts', 'deploy']);

    expect(result.configPath).toBe('config.ts');
    expect(result.names).toStrictEqual(['deploy']);
  });

  it('throws when --config has no value', () => {
    expect(() => parseArgs(['node', 'preflight', '--config'])).toThrow('--config requires a path argument');
  });

  it('throws when -c has no value', () => {
    expect(() => parseArgs(['node', 'preflight', '-c'])).toThrow('--config requires a path argument');
  });

  it('throws when --config= has an empty value', () => {
    expect(() => parseArgs(['node', 'preflight', '--config='])).toThrow('--config requires a path argument');
  });

  it('throws on unknown flags', () => {
    expect(() => parseArgs(['node', 'preflight', '--unknown'])).toThrow("unknown flag '--unknown'");
  });
});

describe(main, () => {
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;
  let originalArgv: string[];
  let lastExitCode: number | undefined;

  beforeEach(() => {
    lastExitCode = undefined;
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      lastExitCode = code;
      throw new ExitError(code);
    });
    originalArgv = process.argv;
    mockReportPreflight.mockReturnValue('report output');
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    mockLoadPreflightConfig.mockReset();
    mockRunPreflight.mockReset();
    mockReportPreflight.mockReset();
  });

  /** Run main, catching ExitError so tests can inspect the exit code. */
  async function runMain(): Promise<void> {
    try {
      await main();
    } catch (error: unknown) {
      if (!(error instanceof ExitError)) throw error;
    }
  }

  it('runs all checklists when no names are given', async () => {
    process.argv = ['node', 'preflight'];
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runMain();

    expect(mockRunPreflight).toHaveBeenCalledTimes(2);
    expect(lastExitCode).toBe(0);
  });

  it('filters to named checklists only', async () => {
    process.argv = ['node', 'preflight', 'deploy'];
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runMain();

    expect(mockRunPreflight).toHaveBeenCalledTimes(1);
    expect(mockRunPreflight).toHaveBeenCalledWith(config.checklists[0]);
  });

  it('errors when an unknown checklist name is given', async () => {
    process.argv = ['node', 'preflight', 'nonexistent'];
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);

    await runMain();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('unknown checklist(s): nonexistent'));
    expect(lastExitCode).toBe(1);
  });

  it('exits with code 1 when any checklist fails', async () => {
    process.argv = ['node', 'preflight'];
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight
      .mockResolvedValueOnce({ results: [], passed: true, durationMs: 0 })
      .mockResolvedValueOnce({ results: [], passed: false, durationMs: 0 });

    await runMain();

    expect(lastExitCode).toBe(1);
  });

  it('passes --config flag to config loader', async () => {
    process.argv = ['node', 'preflight', '--config', 'custom/path.ts'];
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runMain();

    expect(mockLoadPreflightConfig).toHaveBeenCalledWith('custom/path.ts');
  });

  it('shows headers when running multiple checklists', async () => {
    process.argv = ['node', 'preflight'];
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runMain();

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allOutput).toContain('--- deploy ---');
    expect(allOutput).toContain('--- infra ---');
  });

  it('does not show headers for a single checklist', async () => {
    process.argv = ['node', 'preflight', 'deploy'];
    const config = makeConfig();
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runMain();

    const allOutput = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(allOutput).not.toContain('---');
  });

  it('uses per-checklist fixLocation over config default', async () => {
    process.argv = ['node', 'preflight'];
    const config = makeConfig({
      fixLocation: 'END',
      checklists: [{ name: 'deploy', checks: [{ name: 'a', check: () => true }], fixLocation: 'INLINE' }],
    });
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runMain();

    expect(mockReportPreflight).toHaveBeenCalledWith(expect.anything(), { fixLocation: 'INLINE' });
  });

  it('falls back to config-level fixLocation when checklist has none', async () => {
    process.argv = ['node', 'preflight'];
    const config = makeConfig({
      fixLocation: 'END',
      checklists: [{ name: 'deploy', checks: [{ name: 'a', check: () => true }] }],
    });
    mockLoadPreflightConfig.mockResolvedValue(config);
    mockRunPreflight.mockResolvedValue({ results: [], passed: true, durationMs: 0 });

    await runMain();

    expect(mockReportPreflight).toHaveBeenCalledWith(expect.anything(), { fixLocation: 'END' });
  });

  it('reports config loading errors to stderr', async () => {
    process.argv = ['node', 'preflight'];
    mockLoadPreflightConfig.mockRejectedValue(new Error('Config not found'));

    await runMain();

    expect(stderrSpy).toHaveBeenCalledWith('Error: Config not found\n');
    expect(lastExitCode).toBe(1);
  });
});
