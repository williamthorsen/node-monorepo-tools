import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../runCli.ts';
import { runCommand } from '../runner.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

vi.mock(import('../runner.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  runCommand: vi.fn(),
}));

const mockedRunCommand = vi.mocked(runCommand);

describe(runCli, () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-runcli-')));
    fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    mockedRunCommand.mockReset();
    mockedRunCommand.mockResolvedValue({ exitCode: 0, outcome: 'exited', stderr: undefined, stdout: undefined });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  describe('delegation', () => {
    it.each([
      {
        args: ['-F', 'my-pkg', 'build'],
        expected: 'pnpm --filter my-pkg exec nmr build',
        scenario: 'a filter pattern the shell reads literally',
      },
      {
        args: ['-F', './packages/*', 'build'],
        expected: "pnpm --filter './packages/*' exec nmr build",
        scenario: 'a filter pattern the shell would expand',
      },
      {
        args: ['-F', 'my-pkg', 'test', '--reporter=json'],
        expected: 'pnpm --filter my-pkg exec nmr test --reporter=json',
        scenario: 'a passthrough argument needing no quoting',
      },
      {
        args: ['-F', 'my-pkg', 'test', '-t', 'a b'],
        expected: "pnpm --filter my-pkg exec nmr test -t 'a b'",
        scenario: 'a passthrough argument holding a space',
      },
      {
        args: ['-R', 'build'],
        expected: 'pnpm --recursive exec nmr build',
        scenario: 'a recursive delegate',
      },
      {
        args: ['-R', 'test', '--reporter=json'],
        expected: 'pnpm --recursive exec nmr test --reporter=json',
        scenario: 'a recursive delegate carrying a passthrough argument',
      },
    ])('given $scenario, delegates through pnpm', async ({ args, expected }) => {
      await runNmr(args, repo);

      expect(commandFromCall()).toBe(expected);
    });

    it('runs the delegate from the monorepo root', async () => {
      await runNmr(['-F', 'my-pkg', 'build'], repo);

      expect(mockedRunCommand.mock.calls[0]?.[1]).toBe(repo);
    });

    it('tells the recursive delegate to pass over a package that lacks the command', async () => {
      await runNmr(['-R', 'build'], repo);

      expect(mockedRunCommand.mock.calls[0]?.[2].env).toMatchObject({ NMR_RUN_IF_PRESENT: '1' });
    });

    it('leaves the filter delegate to fail on a package that lacks the command', async () => {
      await runNmr(['-F', 'my-pkg', 'build'], repo);

      expect(mockedRunCommand.mock.calls[0]?.[2].env).not.toHaveProperty('NMR_RUN_IF_PRESENT');
    });
  });

  describe('verbosity', () => {
    it.each([
      { args: ['-F', 'my-pkg', 'build'], expected: 'full', scenario: 'a loud run' },
      { args: ['-q', '-F', 'my-pkg', 'build'], expected: 'quiet', scenario: 'a quiet run' },
    ])('given $scenario, hands the resolved verbosity to every process below it', async ({ args, expected }) => {
      await runNmr(args, repo);

      expect(mockedRunCommand.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: expected });
    });

    it('lets an inherited quiet reach a run that passed no flag', async () => {
      await runCli({
        args: ['-F', 'my-pkg', 'build'],
        cwd: repo,
        env: { [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' },
        stderr: new PassThrough(),
        stdout: new PassThrough(),
      });

      expect(mockedRunCommand.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it.each([
      { args: ['--version'], scenario: 'the version flag' },
      { args: ['--help'], scenario: 'the help flag' },
      { args: ['build'], scenario: 'a command' },
    ])('given an unrecognized inherited value, rejects $scenario before doing anything', async ({ args }) => {
      const stdout = new PassThrough();
      const written: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => written.push(chunk));

      const { exitCode } = await runCli({
        args,
        cwd: repo,
        env: { [COMMAND_VERBOSITY_ENV_VAR]: 'silent' },
        stderr: new PassThrough(),
        stdout,
      });

      expect(exitCode).toBe(1);
      expect(Buffer.concat(written)).toHaveLength(0);
      expect(mockedRunCommand).not.toHaveBeenCalled();
    });
  });
});

// region | Helpers

/** Reads the command string the runner was handed. */
function commandFromCall(): string | undefined {
  return mockedRunCommand.mock.calls[0]?.[0];
}

/** Runs the CLI in-process against `cwd`, discarding both output streams. */
async function runNmr(args: string[], cwd: string): Promise<{ exitCode: number }> {
  return runCli({ args, cwd, env: {}, stderr: new PassThrough(), stdout: new PassThrough() });
}

// endregion | Helpers
