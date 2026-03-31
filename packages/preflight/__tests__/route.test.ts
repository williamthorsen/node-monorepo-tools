import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const mockRunCommand = vi.hoisted(() => vi.fn());
const mockInitCommand = vi.hoisted(() => vi.fn());
const mockParseRunArgs = vi.hoisted(() => vi.fn());

vi.mock('../src/cli.ts', () => ({
  parseRunArgs: mockParseRunArgs,
  runCommand: mockRunCommand,
}));

vi.mock('../src/init/initCommand.ts', () => ({
  initCommand: mockInitCommand,
}));

import { routeCommand } from '../src/bin/route.ts';

describe(routeCommand, () => {
  let infoSpy: MockInstance;
  let stderrSpy: MockInstance;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockRunCommand.mockReset();
    mockInitCommand.mockReset();
    mockParseRunArgs.mockReset();
  });

  it('shows help and returns 0 when no arguments are given', async () => {
    const exitCode = await routeCommand([]);

    expect(exitCode).toBe(0);
    const output = infoSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Usage: preflight');
  });

  it('shows help and returns 0 for --help', async () => {
    const exitCode = await routeCommand(['--help']);

    expect(exitCode).toBe(0);
    const output = infoSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Usage: preflight');
  });

  it('shows help and returns 0 for -h', async () => {
    const exitCode = await routeCommand(['-h']);

    expect(exitCode).toBe(0);
  });

  it('shows run help and returns 0 for run --help', async () => {
    const exitCode = await routeCommand(['run', '--help']);

    expect(exitCode).toBe(0);
    const output = infoSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Usage: preflight run');
  });

  it('shows init help and returns 0 for init --help', async () => {
    const exitCode = await routeCommand(['init', '--help']);

    expect(exitCode).toBe(0);
    const output = infoSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Usage: preflight init');
  });

  it('shows init help and returns 0 for init -h', async () => {
    const exitCode = await routeCommand(['init', '-h']);

    expect(exitCode).toBe(0);
  });

  it('delegates to runCommand for run subcommand', async () => {
    mockParseRunArgs.mockReturnValue({ names: ['deploy'], configSource: { type: 'local' }, json: false });
    mockRunCommand.mockResolvedValue(0);

    const exitCode = await routeCommand(['run', 'deploy']);

    expect(mockParseRunArgs).toHaveBeenCalledWith(['deploy']);
    expect(mockRunCommand).toHaveBeenCalledWith({ names: ['deploy'], configSource: { type: 'local' }, json: false });
    expect(exitCode).toBe(0);
  });

  it('passes --json flag through to runCommand', async () => {
    mockParseRunArgs.mockReturnValue({ names: [], configSource: { type: 'local' }, json: true });
    mockRunCommand.mockResolvedValue(0);

    const exitCode = await routeCommand(['run', '--json']);

    expect(mockRunCommand).toHaveBeenCalledWith({ names: [], configSource: { type: 'local' }, json: true });
    expect(exitCode).toBe(0);
  });

  it('includes --json in run help text', async () => {
    await routeCommand(['run', '--help']);

    const output = infoSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('--json');
  });

  it('returns 1 and writes to stderr when parseRunArgs throws', async () => {
    mockParseRunArgs.mockImplementation(() => {
      throw new Error("unknown flag '--bad'");
    });

    const exitCode = await routeCommand(['run', '--bad']);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("unknown flag '--bad'"));
  });

  it('delegates to initCommand for init subcommand', async () => {
    mockInitCommand.mockReturnValue(0);

    const exitCode = await routeCommand(['init']);

    expect(mockInitCommand).toHaveBeenCalledWith({ dryRun: false, force: false });
    expect(exitCode).toBe(0);
  });

  it('passes --dry-run and --force flags to initCommand', async () => {
    mockInitCommand.mockReturnValue(0);

    const exitCode = await routeCommand(['init', '--dry-run', '--force']);

    expect(mockInitCommand).toHaveBeenCalledWith({ dryRun: true, force: true });
    expect(exitCode).toBe(0);
  });

  it('returns 1 for unknown init flags', async () => {
    const exitCode = await routeCommand(['init', '--unknown']);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown option: --unknown'));
  });

  it('returns 1 for unknown commands', async () => {
    const exitCode = await routeCommand(['bogus']);

    expect(exitCode).toBe(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown command: bogus'));
  });
});
