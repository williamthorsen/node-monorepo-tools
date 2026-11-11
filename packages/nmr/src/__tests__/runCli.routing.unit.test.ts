import { PassThrough } from 'node:stream';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { readFilterSelection } from '../helpers/filter-selection.ts';
import { RUN_IF_PRESENT_ENV_VAR, VERSION } from '../invocation.ts';
import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import { createWorkspaceTree } from '../test-utils/run-cli-fixtures.ts';
import { readStepsFromCall, runNmrReadingStderr, runNmrReadingStdout } from '../test-utils/run-cli-harness.ts';

vi.mock(import('../runner.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  runSteps: vi.fn(),
}));

// The probe spawns pnpm, which a unit test neither has nor needs: its answer is the input to the gate.
vi.mock(import('../helpers/filter-selection.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readFilterSelection: vi.fn(),
}));

const mockedRunSteps = vi.mocked(runSteps);

const it = baseIt.extend(
  'tree',
  makeFixture(() => createWorkspaceTree()),
);

describe(runCli, () => {
  beforeEach(() => {
    mockedRunSteps.mockReset();
    mockedRunSteps.mockResolvedValue({ exitCode: 0 });
    vi.mocked(readFilterSelection).mockReturnValue('single');
  });

  describe('help', () => {
    it.for([[], ['-q'], ['-F', 'my-pkg'], ['-h'], ['--help']])(
      'lists the commands for %j and exits 0',
      async (args, { tree }) => {
        const { exitCode, stdout } = await runNmrReadingStdout(args, tree.dir);

        expect(exitCode).toBe(0);
        expect(stdout).toMatch(/^Usage: nmr \[options\] <command>/);
        expect(stdout).toContain('Commands:');
        expect(stdout).toContain('-F, --filter <pattern>');
        expect(stdout).toContain('-V, --version');
        expect(mockedRunSteps).not.toHaveBeenCalled();
      },
    );

    it.for([['-w', '--help'], ['-wh']])('lists the root commands under %j from a package', async (args, { tree }) => {
      const { stdout } = await runNmrReadingStdout(args, tree.resolve('packages/my-pkg'));

      expect(readCommandsBlock(stdout)).toContain('report-overrides');
      expect(stdout).toContain('Workspace commands:');
    });

    it('lists the workspace commands from a package, and the root commands after them', async ({ tree }) => {
      const { stdout } = await runNmrReadingStdout(['--help'], tree.resolve('packages/my-pkg'));

      expect(readCommandsBlock(stdout)).not.toContain('report-overrides');
      expect(stdout).toContain('Root commands:');
    });

    it('rejects -?, which is not a help flag', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-?'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain("Try 'nmr --help'.");
    });
  });

  describe('version', () => {
    it('prints the version outside a monorepo', async () => {
      using tree = createTempTree({}, { prefix: 'nmr-version-' });

      const { exitCode, stdout } = await runNmrReadingStdout(['--version', 'build'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(`${VERSION}\n`);
    });
  });

  describe('usage errors', () => {
    it('reports an unknown command with a suggestion and exits 2', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['bulid'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toBe("nmr: Unknown command: bulid\nDid you mean 'build'?\nTry 'nmr --help'.\n");
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    it('reports a command that only another scope defines in the words of the scope', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['report-overrides'], tree.resolve('packages/my-pkg'));

      expect(exitCode).toBe(2);
      expect(stderr).toContain('Unknown command: report-overrides');
    });

    it('rejects --log without a command', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--log'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('--log requires a command name');
    });

    it('rejects an unknown flag before the command', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--bogus', 'build'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('Unknown option: --bogus');
    });
  });

  describe('dispatch', () => {
    it('fans out a command that only another package defines', async ({ tree }) => {
      tree.writeJson('packages/my-pkg/package.json', { name: 'my-pkg', scripts: { 'only-here': 'echo here' } });

      const { exitCode } = await runNmrReadingStderr(['-F', 'my-pkg', 'only-here'], tree.dir);

      expect(exitCode).toBe(0);
      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'only-here'] },
      ]);
    });

    it('exits 0 for a command that no scope defines, on a delegating caller’s behalf', async ({ tree }) => {
      const { exitCode } = await runCli({
        args: ['never-defined'],
        cwd: tree.dir,
        env: { [RUN_IF_PRESENT_ENV_VAR]: '1' },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(exitCode).toBe(0);
    });

    it('dispatches a hook named directly', async ({ tree }) => {
      tree.writeJson('package.json', { scripts: { 'build:pre': 'echo pre' } });

      const { exitCode } = await runNmrReadingStderr(['build:pre'], tree.dir);

      expect(exitCode).toBe(0);
      expect(mockedRunSteps).toHaveBeenCalled();
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
