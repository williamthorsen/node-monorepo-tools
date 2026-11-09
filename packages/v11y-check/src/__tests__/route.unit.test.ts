import path from 'node:path';
import process from 'node:process';

import { UserError } from '@williamthorsen/nmr-core';
import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { routeCommand, type RouteCommands } from '../route.ts';

/** The route commands as mocks, which a test primes and inspects. */
type FakeRouteCommands = { [Key in keyof RouteCommands]: Mock<RouteCommands[Key]> };

describe(routeCommand, () => {
  let commands: FakeRouteCommands;

  beforeEach(() => {
    commands = buildFakeRouteCommands();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('dispatch', () => {
    it('dispatches flag-only args to checkCommand', async () => {
      await routeCommand(['--json'], commands);
      expect(commands.checkCommand).toHaveBeenCalledWith(
        expect.objectContaining({ isJson: true, scopes: [], verbose: false }),
      );
    });

    it('dispatches empty args to checkCommand', async () => {
      await routeCommand([], commands);
      expect(commands.checkCommand).toHaveBeenCalledWith(
        expect.objectContaining({ isJson: false, scopes: [], verbose: false }),
      );
    });

    it.each([
      [['check', '--dev'], ['dev']],
      [['check', '--prod'], ['prod']],
      [['--dev'], ['dev']],
    ])('dispatches %j to checkCommand with scopes %j', async (args, scopes) => {
      await routeCommand(args, commands);
      expect(commands.checkCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes }));
    });

    it.each([['--verbose'], ['-v']])('forwards %s to checkCommand', async (flag) => {
      await routeCommand([flag], commands);
      expect(commands.checkCommand).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
    });

    it('forwards -j to checkCommand as JSON output', async () => {
      await routeCommand(['check', '-j'], commands);
      expect(commands.checkCommand).toHaveBeenCalledWith(expect.objectContaining({ isJson: true }));
    });

    it.each([['--config'], ['-c']])('forwards an absolute path given to %s', async (flag) => {
      await routeCommand([flag, '/custom/audit.json'], commands);
      expect(commands.checkCommand).toHaveBeenCalledWith(expect.objectContaining({ configPath: '/custom/audit.json' }));
    });

    it('resolves a relative --config path against the working directory', async () => {
      await routeCommand(['-c', 'audit.json'], commands);
      expect(commands.checkCommand).toHaveBeenCalledWith(
        expect.objectContaining({ configPath: path.resolve(process.cwd(), 'audit.json') }),
      );
    });

    it('dispatches "run-audit-ci --dev" to auditCommand with scopes ["dev"]', async () => {
      await routeCommand(['run-audit-ci', '--dev'], commands);
      expect(commands.auditCommand).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['dev'], verbose: false }));
      expect(commands.checkCommand).not.toHaveBeenCalled();
    });

    it('dispatches "sync --json --prod" to syncCommand', async () => {
      await routeCommand(['sync', '--json', '--prod'], commands);
      expect(commands.syncCommand).toHaveBeenCalledWith(expect.objectContaining({ isJson: true, scopes: ['prod'] }));
    });

    it.each([
      [[], false, false],
      [['--dry-run'], true, false],
      [['-n', '-f'], true, true],
    ])('dispatches "init" with %j (isDryRun: %s, shouldForce: %s)', async (flags, isDryRun, shouldForce) => {
      await routeCommand(['init', ...flags], commands);
      expect(commands.initCommand).toHaveBeenCalledWith(expect.objectContaining({ isDryRun, shouldForce }));
    });

    it.each([
      [[], false],
      [['-n'], true],
    ])('dispatches "update-templates" with %j (isDryRun: %s)', async (flags, isDryRun) => {
      await routeCommand(['update-templates', ...flags], commands);
      expect(commands.updateTemplatesCommand).toHaveBeenCalledWith(expect.objectContaining({ isDryRun }));
    });

    it.each(['plain', 'rich'] as const)('passes the %s style resolved from the variable', async (setting) => {
      vi.stubEnv('V11Y_CHECK_OUTPUT_STYLE', setting);

      await routeCommand(['init'], commands);

      expect(commands.initCommand).toHaveBeenCalledWith(
        expect.objectContaining({ styles: { stderr: setting, stdout: setting } }),
      );
    });
  });

  describe('usage errors', () => {
    it.each([
      [['--raw'], 'v11y: Unknown option: --raw', "Try 'v11y check --help'."],
      [['sync', '--verbose'], 'v11y: Unknown option: --verbose', "Try 'v11y sync --help'."],
      [['update-templates', '--force'], 'v11y: Unknown option: --force', "Try 'v11y update-templates --help'."],
      [['--dev', '--prod'], 'v11y: Cannot specify both --dev and --prod', "Try 'v11y check --help'."],
      [['report'], 'v11y: Unknown command: report', "Try 'v11y --help'."],
    ])('exits 2 for %j', async (args, error, pointer) => {
      const stdio = disposeOnTestFinished(captureStdio());

      const exitCode = await routeCommand(args, commands);

      expect(exitCode).toBe(2);
      expect(stdio.stderr).toBe(`${error}\n${pointer}\n`);
      expectNoCommandRan(commands);
    });

    it('suggests the nearest command for a typo', async () => {
      const stdio = disposeOnTestFinished(captureStdio());

      const exitCode = await routeCommand(['chek'], commands);

      expect(exitCode).toBe(2);
      expect(stdio.stderr).toContain("Did you mean 'check'?");
    });

    it.each([[[]], [['init']], [['run-audit-ci']]])(
      'exits 2 for %j when the output-style variable does not name a style',
      async (args) => {
        const stdio = disposeOnTestFinished(captureStdio());
        vi.stubEnv('V11Y_CHECK_OUTPUT_STYLE', 'loud');

        const exitCode = await routeCommand(args, commands);

        expect(exitCode).toBe(2);
        expect(stdio.stderr).toContain('v11y: V11Y_CHECK_OUTPUT_STYLE must be one of: auto, plain, rich (got "loud")');
        expectNoCommandRan(commands);
      },
    );
  });

  describe('failures', () => {
    it('reports a UserError from a command and exits 1', async () => {
      commands.syncCommand.mockRejectedValueOnce(new UserError('Config file not found: /repo/v11y.json'));
      const stdio = disposeOnTestFinished(captureStdio());

      const exitCode = await routeCommand(['sync'], commands);

      expect(exitCode).toBe(1);
      expect(stdio.stderr).toBe('v11y: Config file not found: /repo/v11y.json\n');
    });

    it('rethrows an unexpected error from a command for the crash handler', async () => {
      const crash = new TypeError('cannot read x');
      commands.checkCommand.mockRejectedValueOnce(crash);

      await expect(routeCommand(['check'], commands)).rejects.toBe(crash);
    });
  });

  describe('help and version', () => {
    it.each([['--version'], ['-V']])('prints the version for %s', async (flag) => {
      const stdio = disposeOnTestFinished(captureStdio());

      const exitCode = await routeCommand([flag], commands);

      expect(exitCode).toBe(0);
      expect(stdio.stdout).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('lists every command, the output-style variable, and its three values in the root help', async () => {
      const stdio = disposeOnTestFinished(captureStdio());

      const exitCode = await routeCommand(['-h'], commands);

      expect(exitCode).toBe(0);
      for (const command of ['check', 'run-audit-ci', 'sync', 'init', 'update-templates']) {
        expect(stdio.stdout).toContain(`  ${command} `);
      }
      expect(stdio.stdout).toContain('V11Y_CHECK_OUTPUT_STYLE');
      expect(stdio.stdout).toMatch(/auto.*plain.*rich/);
    });

    it.each([
      ['check', ['--config', '--dev', '--prod', '--json', '--verbose']],
      ['run-audit-ci', ['--config', '--dev', '--prod', '--json']],
      ['sync', ['--config', '--dev', '--prod', '--json']],
      ['init', ['--dry-run', '--force']],
      ['update-templates', ['--dry-run']],
    ])('prints the options of %s on its own help page', async (command, options) => {
      const stdio = disposeOnTestFinished(captureStdio());

      const exitCode = await routeCommand([command, '--help'], commands);

      expect(exitCode).toBe(0);
      expect(stdio.stdout).toContain(`Usage: v11y ${command} [options]`);
      for (const option of options) {
        expect(stdio.stdout).toContain(option);
      }
      expectNoCommandRan(commands);
    });

    it('omits --verbose from the help of sync', async () => {
      const stdio = disposeOnTestFinished(captureStdio());

      await routeCommand(['sync', '--help'], commands);

      expect(stdio.stdout).not.toContain('--verbose');
    });

    it('prints the root help under an invalid output-style variable', async () => {
      const stdio = disposeOnTestFinished(captureStdio());
      vi.stubEnv('V11Y_CHECK_OUTPUT_STYLE', 'loud');

      await expect(routeCommand(['--help'], commands)).resolves.toBe(0);
      expect(stdio.stdout).toContain('Usage: v11y');
    });

    it("exits 2 for a command's help under an invalid output-style variable", async () => {
      disposeOnTestFinished(captureStdio());
      vi.stubEnv('V11Y_CHECK_OUTPUT_STYLE', 'loud');

      await expect(routeCommand(['sync', '--help'], commands)).resolves.toBe(2);
    });
  });
});

// region | Helpers

/** Builds route commands that succeed, as mocks. */
function buildFakeRouteCommands(): FakeRouteCommands {
  return {
    auditCommand: vi.fn<RouteCommands['auditCommand']>().mockResolvedValue(0),
    checkCommand: vi.fn<RouteCommands['checkCommand']>().mockResolvedValue(0),
    initCommand: vi.fn<RouteCommands['initCommand']>().mockReturnValue(0),
    syncCommand: vi.fn<RouteCommands['syncCommand']>().mockResolvedValue(0),
    updateTemplatesCommand: vi.fn<RouteCommands['updateTemplatesCommand']>().mockReturnValue(0),
  };
}

/** Asserts that the router did not reach any command. */
function expectNoCommandRan(commands: FakeRouteCommands): void {
  expect(commands.auditCommand).not.toHaveBeenCalled();
  expect(commands.checkCommand).not.toHaveBeenCalled();
  expect(commands.initCommand).not.toHaveBeenCalled();
  expect(commands.syncCommand).not.toHaveBeenCalled();
  expect(commands.updateTemplatesCommand).not.toHaveBeenCalled();
}

// endregion | Helpers
