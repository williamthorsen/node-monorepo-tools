import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/cli.ts', () => ({
  auditCommand: vi.fn().mockResolvedValue(0),
  checkCommand: vi.fn().mockResolvedValue(0),
  extractMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  syncCommand: vi.fn().mockResolvedValue(0),
}));

vi.mock('../src/init/initCommand.ts', () => ({
  initCommand: vi.fn().mockReturnValue(0),
}));

import { routeCommand } from '../src/bin/route.ts';
import { auditCommand, checkCommand, syncCommand } from '../src/cli.ts';
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

  it('dispatches to checkCommand when no args are given', async () => {
    await routeCommand([]);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: [] }));
  });

  it('dispatches --raw to auditCommand', async () => {
    await routeCommand(['--raw']);
    expect(auditCommand).toHaveBeenCalled();
  });

  it('dispatches --raw --dev to auditCommand with scopes ["dev"]', async () => {
    await routeCommand(['--raw', '--dev']);
    expect(auditCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['dev'] }));
  });

  it('dispatches --raw --prod to auditCommand with scopes ["prod"]', async () => {
    await routeCommand(['--raw', '--prod']);
    expect(auditCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['prod'] }));
  });

  it('returns 1 for "report" (removed subcommand)', async () => {
    const exitCode = await routeCommand(['report']);
    expect(exitCode).toBe(1);
  });

  it('returns 1 for "generate" (removed subcommand)', async () => {
    const exitCode = await routeCommand(['generate']);
    expect(exitCode).toBe(1);
  });

  it('dispatches "check" to checkCommand', async () => {
    await routeCommand(['check']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: [] }));
  });

  it('dispatches "check --json" to checkCommand with json: true', async () => {
    await routeCommand(['check', '--json']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ json: true, scopes: [] }));
  });

  it('dispatches "check --dev" to checkCommand with scopes ["dev"]', async () => {
    await routeCommand(['check', '--dev']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['dev'] }));
  });

  it('dispatches "sync" to syncCommand', async () => {
    await routeCommand(['sync']);
    expect(syncCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: [] }));
  });

  it('dispatches "sync --dev" with scopes ["dev"]', async () => {
    await routeCommand(['sync', '--dev']);
    expect(syncCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['dev'] }));
  });

  it('dispatches "init" to initCommand', async () => {
    await routeCommand(['init']);
    expect(initCommand).toHaveBeenCalled();
  });

  it('dispatches flag-only args to checkCommand', async () => {
    await routeCommand(['--json']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ json: true }));
  });

  it('returns 1 for unknown command with typo match', async () => {
    const exitCode = await routeCommand(['syn']);
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

  it('forwards --config flag to checkCommand', async () => {
    await routeCommand(['--config', '/custom/audit.json']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ configPath: '/custom/audit.json' }));
  });

  it('forwards --verbose flag to checkCommand', async () => {
    await routeCommand(['--verbose']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });

  it('forwards -v short flag to checkCommand', async () => {
    await routeCommand(['-v']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });

  it('defaults verbose to false when the flag is not provided', async () => {
    await routeCommand([]);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ verbose: false }));
  });

  it('composes --verbose with --json', async () => {
    await routeCommand(['--verbose', '--json']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ json: true, verbose: true }));
  });

  it('composes --verbose with --dev', async () => {
    await routeCommand(['--verbose', '--dev']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['dev'], verbose: true }));
  });

  it('composes --verbose with --prod', async () => {
    await routeCommand(['--verbose', '--prod']);
    expect(checkCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['prod'], verbose: true }));
  });

  it('composes --verbose with --config', async () => {
    await routeCommand(['--verbose', '--config', '/custom/audit.json']);
    expect(checkCommand).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: '/custom/audit.json', verbose: true }),
    );
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
