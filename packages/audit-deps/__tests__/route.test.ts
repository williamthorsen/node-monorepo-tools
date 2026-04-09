import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/cli.ts', () => ({
  auditCommand: vi.fn().mockResolvedValue(0),
  generateCommand: vi.fn().mockResolvedValue(0),
  reportCommand: vi.fn().mockResolvedValue(0),
  syncCommand: vi.fn().mockResolvedValue(0),
}));

vi.mock('../src/init/initCommand.ts', () => ({
  initCommand: vi.fn().mockReturnValue(0),
}));

import { routeCommand } from '../src/bin/route.ts';
import { auditCommand, generateCommand, reportCommand, syncCommand } from '../src/cli.ts';
import { initCommand } from '../src/init/initCommand.ts';

describe(routeCommand, () => {
  afterEach(() => {
    vi.clearAllMocks();
  });
  it('returns 0 for --version', async () => {
    const exitCode = await routeCommand(['--version']);
    expect(exitCode).toBe(0);
  });

  it('returns 0 for -V', async () => {
    const exitCode = await routeCommand(['-V']);
    expect(exitCode).toBe(0);
  });

  it('returns 0 for --help', async () => {
    const exitCode = await routeCommand(['--help']);
    expect(exitCode).toBe(0);
  });

  it('returns 0 for -h', async () => {
    const exitCode = await routeCommand(['-h']);
    expect(exitCode).toBe(0);
  });

  it('returns 0 when no args are given', async () => {
    const exitCode = await routeCommand([]);
    expect(exitCode).toBe(0);
  });

  it('dispatches "report" to reportCommand', async () => {
    await routeCommand(['report']);
    expect(reportCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: [] }));
  });

  it('dispatches "report --dev" with scopes ["dev"]', async () => {
    await routeCommand(['report', '--dev']);
    expect(reportCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['dev'] }));
  });

  it('dispatches "report --prod" with scopes ["prod"]', async () => {
    await routeCommand(['report', '--prod']);
    expect(reportCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['prod'] }));
  });

  it('dispatches "sync" to syncCommand', async () => {
    await routeCommand(['sync']);
    expect(syncCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: [] }));
  });

  it('dispatches "sync --dev" with scopes ["dev"]', async () => {
    await routeCommand(['sync', '--dev']);
    expect(syncCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['dev'] }));
  });

  it('dispatches "generate" to generateCommand', async () => {
    await routeCommand(['generate']);
    expect(generateCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: [] }));
  });

  it('dispatches "init" to initCommand', async () => {
    await routeCommand(['init']);
    expect(initCommand).toHaveBeenCalled();
  });

  it('falls through to auditCommand for unknown flags', async () => {
    await routeCommand(['--json']);
    expect(auditCommand).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
  });

  it('returns 1 for unknown command with typo match', async () => {
    const exitCode = await routeCommand(['rep']);
    expect(exitCode).toBe(1);
  });

  it('returns 1 for unknown positional argument', async () => {
    const exitCode = await routeCommand(['foo']);
    expect(exitCode).toBe(1);
  });

  it('returns 1 when --dev and --prod are both specified', async () => {
    const exitCode = await routeCommand(['--dev', '--prod']);
    expect(exitCode).toBe(1);
  });

  it('returns 0 for subcommand --help (e.g., report --help)', async () => {
    const exitCode = await routeCommand(['report', '--help']);
    expect(exitCode).toBe(0);
    // reportCommand should not be called when showing help
    expect(reportCommand).not.toHaveBeenCalled();
  });

  it('returns 0 for sync --help', async () => {
    const exitCode = await routeCommand(['sync', '--help']);
    expect(exitCode).toBe(0);
    expect(syncCommand).not.toHaveBeenCalled();
  });

  it('returns 0 for init --help', async () => {
    const exitCode = await routeCommand(['init', '--help']);
    expect(exitCode).toBe(0);
    expect(initCommand).not.toHaveBeenCalled();
  });

  it('forwards --config flag to reportCommand', async () => {
    await routeCommand(['report', '--config', '/custom/audit.json']);
    expect(reportCommand).toHaveBeenCalledWith(expect.objectContaining({ configPath: '/custom/audit.json' }));
  });

  it('forwards --dry-run flag to initCommand', async () => {
    await routeCommand(['init', '--dry-run']);
    expect(initCommand).toHaveBeenCalledWith({ dryRun: true, force: false });
  });

  it('forwards --force flag to initCommand', async () => {
    await routeCommand(['init', '--force']);
    expect(initCommand).toHaveBeenCalledWith({ dryRun: false, force: true });
  });
});
