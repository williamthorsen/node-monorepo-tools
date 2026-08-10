import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import type { Step } from '../steps.ts';
import { renderChain } from '../steps.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

vi.mock(import('../runner.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  runSteps: vi.fn(),
}));

const mockedRunSteps = vi.mocked(runSteps);

describe(runCli, () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-runcli-')));
    fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    mockedRunSteps.mockReset();
    mockedRunSteps.mockResolvedValue({ exitCode: 0 });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  describe('delegation', () => {
    it.each([
      {
        args: ['-F', 'my-pkg', 'build'],
        expected: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'build'],
        scenario: 'a filter pattern the shell reads literally',
      },
      {
        args: ['-F', './packages/*', 'build'],
        expected: ['pnpm', '--filter', './packages/*', 'exec', 'nmr', 'build'],
        scenario: 'a filter pattern the shell would expand',
      },
      {
        args: ['-F', 'my-pkg', 'test', '--reporter=json'],
        expected: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'test', '--reporter=json'],
        scenario: 'a passthrough argument needing no quoting',
      },
      {
        args: ['-F', 'my-pkg', 'test', '-t', 'a b'],
        expected: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'test', '-t', 'a b'],
        scenario: 'a passthrough argument holding a space',
      },
      {
        args: ['-R', 'build'],
        expected: ['pnpm', '--recursive', 'exec', 'nmr', 'build'],
        scenario: 'a recursive delegate',
      },
    ])('given $scenario, delegates through pnpm as argv tokens', async ({ args, expected }) => {
      await runNmr(args, repo);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'structural', argv: expected }]);
    });

    // A delegate spawns `pnpm`, not `nmr`, and still inherits: what classifies a step is how nmr composed it.
    it('classifies the delegate as structural although the binary it spawns is pnpm', async () => {
      await runNmr(['-R', 'build'], repo);

      expect(stepsFromCall()?.[0]?.kind).toBe('structural');
    });

    it('renders the delegate to the chain string it had as one shell command', async () => {
      await runNmr(['-F', './packages/*', 'test', '-t', 'a b'], repo);

      expect(renderChain(stepsFromCall() ?? [])).toBe("pnpm --filter './packages/*' exec nmr test -t 'a b'");
    });

    it('runs the delegate from the monorepo root', async () => {
      await runNmr(['-F', 'my-pkg', 'build'], repo);

      expect(mockedRunSteps.mock.calls[0]?.[1]).toBe(repo);
    });

    it('tells the recursive delegate to pass over a package that lacks the command', async () => {
      await runNmr(['-R', 'build'], repo);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ NMR_RUN_IF_PRESENT: '1' });
    });

    it('leaves the filter delegate to fail on a package that lacks the command', async () => {
      await runNmr(['-F', 'my-pkg', 'build'], repo);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).not.toHaveProperty('NMR_RUN_IF_PRESENT');
    });
  });

  describe('step composition', () => {
    it('resolves a composite to one structural step per element', async () => {
      await runNmr(['fix'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });

    it('resolves a string script to one opaque step', async () => {
      await runNmr(['lint'], repo);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'opaque', command: 'eslint --fix .' }]);
    });

    it('propagates `-w` to each element, so a child selects the root registry on its own', async () => {
      await runNmr(['-w', 'fix'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', '-w', 'lint'] },
        { kind: 'structural', argv: ['nmr', '-w', 'fmt'] },
      ]);
    });

    it('wraps a command in the hooks that resolve, as structural steps of their own', async () => {
      writeConfig(repo, { rootScripts: { 'lint:post': 'echo done', 'lint:pre': 'echo starting' } });

      await runNmr(['lint'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint:pre'] },
        { kind: 'opaque', command: 'eslint --fix .' },
        { kind: 'structural', argv: ['nmr', 'lint:post'] },
      ]);
    });
  });

  describe('passthrough arguments', () => {
    it('binds to the last element of a composite and never to a hook', async () => {
      writeConfig(repo, { rootScripts: { 'fix:post': 'echo done', 'fix:pre': 'echo starting' } });

      await runNmr(['fix', '--dry-run'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'fix:pre'] },
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fix:post'] },
      ]);
    });

    it('binds to a string script as shell-quoted text', async () => {
      await runNmr(['lint', '--max-warnings', '0'], repo);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'opaque', command: "eslint --fix . '--max-warnings' '0'" }]);
    });

    it('quotes a structural argument once, where the chain string quotes only what the shell would act on', async () => {
      await runNmr(['fix', '-t', 'a b'], repo);

      expect(stepsFromCall()?.at(-1)).toStrictEqual({ kind: 'structural', argv: ['nmr', 'fmt', '-t', 'a b'] });
      expect(renderChain(stepsFromCall() ?? [])).toBe("nmr lint && nmr fmt -t 'a b'");
    });
  });

  describe('devBin substitution', () => {
    it('substitutes a leaf tool, which is the case the README documents', async () => {
      writeConfig(repo, { devBin: { eslint: 'node ./scripts/eslint.js' } });

      await runNmr(['lint'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'opaque', command: `node ${path.join(repo, 'scripts/eslint.js')} --fix .` },
      ]);
    });

    // A composite's first position is nmr's own, not a leaf tool's: substituting it replaced one link of a
    // chain and left the rest running the published binary.
    it('leaves a composite alone, where the first token is the nmr that carries it', async () => {
      writeConfig(repo, { devBin: { nmr: 'node ./cli.js' } });

      await runNmr(['fix'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });
  });

  describe('verbosity', () => {
    it.each([
      { args: ['-F', 'my-pkg', 'build'], expected: 'full', scenario: 'a loud run' },
      { args: ['-q', '-F', 'my-pkg', 'build'], expected: 'quiet', scenario: 'a quiet run' },
    ])('given $scenario, hands the resolved verbosity to every process below it', async ({ args, expected }) => {
      await runNmr(args, repo);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: expected });
    });

    it('lets an inherited quiet reach a run that passed no flag', async () => {
      await runNmr(['-F', 'my-pkg', 'build'], repo, { [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which `-q` does not.
    it('renders the same chain string loud and quiet', async () => {
      await runNmr(['fix'], repo);
      const loud = renderChain(stepsFromCall() ?? []);

      mockedRunSteps.mockClear();
      await runNmr(['-q', 'fix'], repo);

      expect(renderChain(stepsFromCall() ?? [])).toBe(loud);
    });

    it.each([
      { args: ['--version'], scenario: 'the version flag' },
      { args: ['--help'], scenario: 'the help flag' },
      { args: ['build'], scenario: 'a command' },
    ])('given an unrecognized inherited value, rejects $scenario before doing anything', async ({ args }) => {
      const stdout = new PassThrough();
      const written: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => {
        written.push(chunk);
      });

      const { exitCode } = await runCli({
        args,
        cwd: repo,
        env: { [COMMAND_VERBOSITY_ENV_VAR]: 'silent' },
        stderr: new PassThrough(),
        stdout,
      });

      expect(exitCode).toBe(1);
      expect(Buffer.concat(written)).toHaveLength(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });
  });

  describe('exit codes', () => {
    it('propagates what the sequence returned', async () => {
      mockedRunSteps.mockResolvedValue({ exitCode: 2 });

      await expect(runNmr(['fix'], repo)).resolves.toStrictEqual({ exitCode: 2 });
    });
  });
});

// region | Helpers

/** Runs the CLI in-process against `cwd`, discarding both output streams. */
async function runNmr(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ exitCode: number }> {
  return runCli({ args, cwd, env, stderr: new PassThrough(), stdout: new PassThrough() });
}

/** Reads the step list the runner was handed. */
function stepsFromCall(): readonly Step[] | undefined {
  return mockedRunSteps.mock.calls[0]?.[0];
}

/** Writes a monorepo-root config, which is the only tier that carries `devBin` and the script registries. */
function writeConfig(repo: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.join(repo, '.config'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.config', 'nmr.config.ts'), `export default ${JSON.stringify(config)};\n`);
}

// endregion | Helpers
