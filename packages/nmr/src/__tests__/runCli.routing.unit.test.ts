import { PassThrough } from 'node:stream';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect } from 'vitest';

import { RUN_IF_PRESENT_ENV_VAR, VERSION } from '../invocation.ts';
import { runCli } from '../runCli.ts';
import { it } from '../test-utils/run-cli-fixtures.ts';

describe(runCli, () => {
  describe('help', () => {
    it.for([[], ['-q'], ['-F', 'my-pkg'], ['-h'], ['--help']])(
      'lists the commands for %j and exits 0',
      async (args, { nmr, tree }) => {
        const { exitCode, stdout } = await nmr.runReadingStdout(args, tree.dir);

        expect(exitCode).toBe(0);
        expect(stdout).toMatch(/^Usage: nmr \[options\] <command>/);
        expect(stdout).toContain('Commands:');
        expect(stdout).toContain('-F, --filter <pattern>');
        expect(stdout).toContain('-V, --version');
        expect(nmr.runSteps).not.toHaveBeenCalled();
      },
    );

    it.for([['-w', '--help'], ['-wh']])(
      'lists the root commands under %j from a package',
      async (args, { nmr, tree }) => {
        const { stdout } = await nmr.runReadingStdout(args, tree.resolve('packages/my-pkg'));

        expect(readCommandsBlock(stdout)).toContain('report-overrides');
        expect(stdout).toContain('Workspace commands:');
      },
    );

    it('lists the workspace commands from a package, and the root commands after them', async ({ nmr, tree }) => {
      const { stdout } = await nmr.runReadingStdout(['--help'], tree.resolve('packages/my-pkg'));

      expect(readCommandsBlock(stdout)).not.toContain('report-overrides');
      expect(stdout).toContain('Root commands:');
    });

    it('rejects -?, which is not a help flag', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['-?'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain("Try 'nmr --help'.");
    });
  });

  describe('version', () => {
    it('prints the version outside a monorepo', async ({ nmr }) => {
      using tree = createTempTree({}, { prefix: 'nmr-version-' });

      const { exitCode, stdout } = await nmr.runReadingStdout(['--version', 'build'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(`${VERSION}\n`);
    });
  });

  describe('usage errors', () => {
    it('reports an unknown command with a suggestion and exits 2', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['bulid'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toBe("nmr: Unknown command: bulid\nDid you mean 'build'?\nTry 'nmr --help'.\n");
      expect(nmr.runSteps).not.toHaveBeenCalled();
    });

    it('reports a command that only another scope defines in the words of the scope', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['report-overrides'], tree.resolve('packages/my-pkg'));

      expect(exitCode).toBe(2);
      expect(stderr).toContain('Unknown command: report-overrides');
    });

    it('rejects --log without a command', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--log'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('--log requires a command name');
    });

    it('rejects an unknown flag before the command', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--bogus', 'build'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('Unknown option: --bogus');
    });
  });

  describe('dispatch', () => {
    it('fans out a command that only another package defines', async ({ nmr, tree }) => {
      tree.writeJson('packages/my-pkg/package.json', { name: 'my-pkg', scripts: { 'only-here': 'echo here' } });

      const { exitCode } = await nmr.runReadingStderr(['-F', 'my-pkg', 'only-here'], tree.dir);

      expect(exitCode).toBe(0);
      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'only-here'] },
      ]);
    });

    it('exits 0 for a command that no scope defines, on a delegating caller’s behalf', async ({ nmr, tree }) => {
      const { exitCode } = await runCli({
        ...nmr.deps,
        args: ['never-defined'],
        cwd: tree.dir,
        env: { [RUN_IF_PRESENT_ENV_VAR]: '1' },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(exitCode).toBe(0);
    });

    it('dispatches a hook named directly', async ({ nmr, tree }) => {
      tree.writeJson('package.json', { scripts: { 'build:pre': 'echo pre' } });

      const { exitCode } = await nmr.runReadingStderr(['build:pre'], tree.dir);

      expect(exitCode).toBe(0);
      expect(nmr.runSteps).toHaveBeenCalled();
    });
  });
});

// region | Helpers

/** Returns the `Commands:` block of a help page. */
function readCommandsBlock(help: string): string {
  const start = help.indexOf('Commands:');
  const end = help.indexOf('\n\n', start);
  return help.slice(start, end);
}

// endregion | Helpers
