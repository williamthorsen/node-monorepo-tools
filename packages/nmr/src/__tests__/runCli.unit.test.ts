import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import type { Step } from '../steps.ts';
import { renderChain } from '../steps.ts';
import { UserError } from '../UserError.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

vi.mock(import('../runner.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  runSteps: vi.fn(),
}));

const mockedRunSteps = vi.mocked(runSteps);

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() =>
    createTempTree({ 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' }, { prefix: 'nmr-runcli-' }),
  ),
);

describe(runCli, () => {
  beforeEach(() => {
    mockedRunSteps.mockReset();
    mockedRunSteps.mockResolvedValue({ exitCode: 0 });
  });

  describe('delegation', () => {
    it.for([
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
    ])('given $scenario, delegates through pnpm as argv tokens', async ({ args, expected }, { tree }) => {
      await runNmr(args, tree.dir);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'structural', argv: expected }]);
    });

    // A delegate spawns `pnpm`, not `nmr`, and still inherits: what classifies a step is how nmr composed it.
    it('classifies the delegate as structural although the binary it spawns is pnpm', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(stepsFromCall()?.[0]?.kind).toBe('structural');
    });

    it('renders the delegate to the chain string it had as one shell command', async ({ tree }) => {
      await runNmr(['-F', './packages/*', 'test', '-t', 'a b'], tree.dir);

      expect(renderChain(stepsFromCall() ?? [])).toBe("pnpm --filter './packages/*' exec nmr test -t 'a b'");
    });

    it('runs the delegate from the monorepo root', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[1]).toBe(tree.dir);
    });

    it('tells the recursive delegate to pass over a package that lacks the command', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ NMR_RUN_IF_PRESENT: '1' });
    });

    it('leaves the filter delegate to fail on a package that lacks the command', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).not.toHaveProperty('NMR_RUN_IF_PRESENT');
    });

    it.for([
      {
        args: ['-F', 'my-pkg', '--log', 'test'],
        expected: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', '--log', 'test'],
      },
      { args: ['-R', '--log', 'test'], expected: ['pnpm', '--recursive', 'exec', 'nmr', '--log', 'test'] },
    ])('carries `--log` into the delegate, ahead of the command name', async ({ args, expected }, { tree }) => {
      await runNmr(args, tree.dir);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'structural', argv: expected }]);
    });

    // A fan-out asks every selected scope, so a scope that never ran the command is a gap in a survey rather
    // than a failure of one.
    it('tells a `--log` filter delegate to pass over a scope with nothing to show', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', '--log', 'test'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ NMR_RUN_IF_PRESENT: '1' });
    });
  });

  describe('step composition', () => {
    it('resolves a composite to one structural step per element', async ({ tree }) => {
      await runNmr(['fix'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });

    it('resolves a string script to one opaque step', async ({ tree }) => {
      await runNmr(['lint'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'opaque', command: 'eslint --fix .' }]);
    });

    it('propagates `-w` to each element, so a child selects the root registry on its own', async ({ tree }) => {
      await runNmr(['-w', 'fix'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', '-w', 'lint'] },
        { kind: 'structural', argv: ['nmr', '-w', 'fmt'] },
      ]);
    });

    it('wraps a command in the hooks that resolve, as structural steps of their own', async ({ tree }) => {
      writeConfig(tree.dir, { rootScripts: { 'lint:post': 'echo done', 'lint:pre': 'echo starting' } });

      await runNmr(['lint'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint:pre'] },
        { kind: 'opaque', command: 'eslint --fix .' },
        { kind: 'structural', argv: ['nmr', 'lint:post'] },
      ]);
    });
  });

  describe('passthrough arguments', () => {
    it('binds to every element of a composite and never to a hook', async ({ tree }) => {
      writeConfig(tree.dir, { rootScripts: { 'fix:post': 'echo done', 'fix:pre': 'echo starting' } });

      await runNmr(['fix', '--dry-run'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'fix:pre'] },
        { kind: 'structural', argv: ['nmr', 'lint', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fmt', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fix:post'] },
      ]);
    });

    it('leaves a declining element unnarrowed', async ({ tree }) => {
      writeConfig(tree.dir, {
        rootScripts: { verify: [{ run: 'build', declinesArgs: true }, 'lint'] },
      });

      await runNmr(['verify', 'src/'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'build'], declinesArgs: true },
        { kind: 'structural', argv: ['nmr', 'lint', 'src/'] },
      ]);
    });

    it('runs nothing when no element accepts them, naming the command', async ({ tree }) => {
      writeConfig(tree.dir, {
        rootScripts: {
          verify: [
            { run: 'build', declinesArgs: true },
            { run: 'lint', declinesArgs: true },
          ],
        },
      });

      const { exitCode, stderr } = await runNmrReadingStderr(['verify', 'src/'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stepsFromCall()).toBeUndefined();
      expect(stderr).toContain('`verify` takes no trailing arguments');
    });

    // The rejection precedes the recording branch, so reading what a command did and running it answer an
    // unroutable argument alike rather than one reporting nothing recorded.
    it('rejects an unroutable argument under --log too', async ({ tree }) => {
      writeConfig(tree.dir, {
        rootScripts: {
          verify: [
            { run: 'build', declinesArgs: true },
            { run: 'lint', declinesArgs: true },
          ],
        },
      });

      const { exitCode, stderr } = await runNmrReadingStderr(['--log', 'verify', 'src/'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('`verify` takes no trailing arguments');
    });

    // An empty override resolves to no steps, and no step accepts on an empty list. The no-op check precedes
    // the rejection so the override keeps reporting as one.
    it('reports an empty override as a no-op rather than rejecting the argument', async ({ tree }) => {
      writeConfig(tree.dir, { rootScripts: { verify: [] } });

      const { exitCode, stdout } = await runNmrReadingStdout(['verify', 'src/'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('verify: skipped, the override is empty');
    });

    it('binds to a string script as shell-quoted text', async ({ tree }) => {
      await runNmr(['lint', '--max-warnings', '0'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'opaque', command: "eslint --fix . '--max-warnings' '0'" }]);
    });

    it('quotes a structural argument once, where the chain string quotes only what the shell would act on', async ({
      tree,
    }) => {
      await runNmr(['fix', '-t', 'a b'], tree.dir);

      expect(stepsFromCall()?.at(-1)).toStrictEqual({ kind: 'structural', argv: ['nmr', 'fmt', '-t', 'a b'] });
      expect(renderChain(stepsFromCall() ?? [])).toBe("nmr lint -t 'a b' && nmr fmt -t 'a b'");
    });
  });

  describe('devBin substitution', () => {
    it('substitutes a leaf tool, which is the case the README documents', async ({ tree }) => {
      writeConfig(tree.dir, { devBin: { eslint: 'node ./scripts/eslint.js' } });

      await runNmr(['lint'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'opaque', command: `node ${path.join(tree.dir, 'scripts/eslint.js')} --fix .` },
      ]);
    });

    // A composite's first position is nmr's own, not a leaf tool's: substituting it replaced one link of a
    // chain and left the rest running the published binary.
    it('leaves a composite alone, where the first token is the nmr that carries it', async ({ tree }) => {
      writeConfig(tree.dir, { devBin: { nmr: 'node ./cli.js' } });

      await runNmr(['fix'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });
  });

  describe('verbosity', () => {
    it.for([
      { args: ['-F', 'my-pkg', 'build'], expected: 'full', scenario: 'a loud run' },
      { args: ['-q', '-F', 'my-pkg', 'build'], expected: 'quiet', scenario: 'a quiet run' },
    ])(
      'given $scenario, hands the resolved verbosity to every process below it',
      async ({ args, expected }, { tree }) => {
        await runNmr(args, tree.dir);

        expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: expected });
      },
    );

    it('lets an inherited quiet reach a run that passed no flag', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which `-q` does not.
    it('renders the same chain string loud and quiet', async ({ tree }) => {
      await runNmr(['fix'], tree.dir);
      const loud = renderChain(stepsFromCall() ?? []);

      mockedRunSteps.mockClear();
      await runNmr(['-q', 'fix'], tree.dir);

      expect(renderChain(stepsFromCall() ?? [])).toBe(loud);
    });

    it.for([
      { args: ['--version'], scenario: 'the version flag' },
      { args: ['--help'], scenario: 'the help flag' },
      { args: ['build'], scenario: 'a command' },
    ])('given an unrecognized inherited value, rejects $scenario before doing anything', async ({ args }, { tree }) => {
      const stdout = new PassThrough();
      const written: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => {
        written.push(chunk);
      });

      const { exitCode } = await runCli({
        args,
        cwd: tree.dir,
        env: { [COMMAND_VERBOSITY_ENV_VAR]: 'silent' },
        stderr: new PassThrough(),
        stdout,
      });

      expect(exitCode).toBe(1);
      expect(Buffer.concat(written)).toHaveLength(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    // The config is loaded after this point, so reaching it would make an invalid one break an unrelated flag.
    it('reports the version against a repo whose config cannot be loaded', async ({ tree }) => {
      fs.mkdirSync(path.join(tree.dir, '.config'), { recursive: true });
      fs.writeFileSync(path.join(tree.dir, '.config', 'nmr.config.ts'), `export default { bild: {} };\n`);

      const { exitCode, stdout } = await runNmrReadingStdout(['--version'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).not.toBe('');
    });

    it('takes the verbosity the repo configured', async ({ tree }) => {
      writeConfig(tree.dir, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('lets an inherited full outrank a quiet the repo configured', async ({ tree }) => {
      writeConfig(tree.dir, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('goes quiet under a harness on the shipped list', async ({ tree }) => {
      await runNmr(['fix'], tree.dir, { CLAUDECODE: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('goes quiet under a harness the repo added', async ({ tree }) => {
      writeConfig(tree.dir, { output: { extraAgentEnvVars: ['MY_CLI'] } });

      await runNmr(['fix'], tree.dir, { MY_CLI: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // Declining detection is what a configured `full` says, so no switch of its own exists to turn it off.
    it('stays loud under a detected harness when the repo configured full', async ({ tree }) => {
      writeConfig(tree.dir, { output: { commandVerbosity: 'full' } });

      await runNmr(['fix'], tree.dir, { CLAUDECODE: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('leaves an unrecognized harness exactly as loud as it is today', async ({ tree }) => {
      await runNmr(['fix'], tree.dir, { SOME_OTHER_CLI: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });
  });

  describe('report format', () => {
    it.for([
      { args: ['-F', 'my-pkg', 'build'], expected: 'text', scenario: 'a run passing no flag' },
      { args: ['--json', '-F', 'my-pkg', 'build'], expected: 'json', scenario: 'a run passing the flag' },
    ])('given $scenario, hands the resolved format to every process below it', async ({ args, expected }, { tree }) => {
      await runNmr(args, tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: expected });
    });

    it('lets an inherited json reach a run that passed no flag', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir, { [REPORT_FORMAT_ENV_VAR]: 'json' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    it('lets the flag outrank an inherited text', async ({ tree }) => {
      await runNmr(['--json', 'fix'], tree.dir, { [REPORT_FORMAT_ENV_VAR]: 'text' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    // Stdout carries the objects and nothing else may, so the loudness ladder does not get to fill it.
    it.for([
      { env: {}, scenario: 'a run with nothing set' },
      { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'full' }, scenario: 'an inherited full' },
    ])('withholds the command output given $scenario', async ({ env }, { tree }) => {
      await runNmr(['--json', 'fix'], tree.dir, env);

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('carries the quiet a machine-readable run forces to every process below it', async ({ tree }) => {
      await runNmr(['--json', '-F', 'my-pkg', 'build'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which this does not.
    it('renders the same chain string in either format', async ({ tree }) => {
      await runNmr(['fix'], tree.dir);
      const text = renderChain(stepsFromCall() ?? []);

      mockedRunSteps.mockClear();
      await runNmr(['--json', 'fix'], tree.dir);

      expect(renderChain(stepsFromCall() ?? [])).toBe(text);
    });

    it.for([
      { args: ['--version'], scenario: 'the version flag' },
      { args: ['--help'], scenario: 'the help flag' },
      { args: ['build'], scenario: 'a command' },
    ])('given an unrecognized inherited value, rejects $scenario before doing anything', async ({ args }, { tree }) => {
      const stdout = new PassThrough();
      const written: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => {
        written.push(chunk);
      });

      const { exitCode } = await runCli({
        args,
        cwd: tree.dir,
        env: { [REPORT_FORMAT_ENV_VAR]: 'ndjson' },
        stderr: new PassThrough(),
        stdout,
      });

      expect(exitCode).toBe(1);
      expect(Buffer.concat(written)).toHaveLength(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });
  });

  describe('exit codes', () => {
    it('propagates what the sequence returned', async ({ tree }) => {
      mockedRunSteps.mockResolvedValue({ exitCode: 2 });

      await expect(runNmr(['fix'], tree.dir)).resolves.toStrictEqual({ exitCode: 2 });
    });
  });

  describe('the shelled-nmr boundary', () => {
    // The remedy follows from where the step was declared, so each origin gets the edit that resolves it.
    it.for([
      {
        expected:
          '⚠️ .config/nmr.config.ts: `rootScripts.probe` reaches nmr through a shell ' +
          "(`nmr fmt && echo done`), so nmr handles the nested run's output as a tool's. " +
          'Write the nmr steps as a step list, and move any others to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a config entry',
        setup: (repo: string) => writeConfig(repo, { rootScripts: { probe: 'nmr fmt && echo done' } }),
      },
      {
        expected:
          '⚠️ package.json: `scripts.fix` reaches nmr through a shell (`nmr lint && nmr fmt`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          "Delete the entry: nmr's own `fix` already runs `nmr lint && nmr fmt`.",
        command: 'fix',
        scenario: 'a package.json entry restating what nmr already runs',
        setup: (repo: string) => writePackageScripts(repo, { fix: 'nmr lint && nmr fmt' }),
      },
      {
        expected:
          '⚠️ package.json: `scripts.fix` reaches nmr through a shell (`nmr lint && rdy compile`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'Delete the entry and move the steps it adds to a `fix:pre` or `fix:post` script.',
        command: 'fix',
        scenario: 'a package.json entry adding steps to what nmr already runs',
        setup: (repo: string) => writePackageScripts(repo, { fix: 'nmr lint && rdy compile' }),
      },
      {
        expected:
          '⚠️ package.json: `scripts.probe` reaches nmr through a shell (`nmr fmt && tsx sync.ts`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script holds no step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a package.json entry whose command the registry does not define',
        setup: (repo: string) => writePackageScripts(repo, { probe: 'nmr fmt && tsx sync.ts' }),
      },
      {
        expected:
          '⚠️ package.json: `scripts.probe` reaches nmr through a shell (`tsx sync.ts\\nnmr fmt`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script holds no step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a package.json entry written across lines, whose entry quotes as the file holds it',
        setup: (repo: string) => writePackageScripts(repo, { probe: 'tsx sync.ts\nnmr fmt' }),
      },
    ])(
      'given $scenario, names the site and the edit that resolves it',
      async ({ command, expected, setup }, { tree }) => {
        setup(tree.dir);

        const { stderr } = await runNmrReadingStderr([command], tree.dir);

        expect(stderr.trim()).toBe(expected);
      },
    );

    // nmr wraps a hook in no hooks of its own, so a `probe:post:pre` would name a script that never runs.
    it.for([
      {
        expected:
          '⚠️ .config/nmr.config.ts: `rootScripts.probe:post` reaches nmr through a shell ' +
          "(`nmr fmt && echo done`), so nmr handles the nested run's output as a tool's. " +
          'Write the nmr steps as a step list, and move any others to a script of their own that the step ' +
          'list names, because a hook has no `:pre` or `:post` of its own.',
        scenario: 'a config entry',
        setup: (repo: string) => writeConfig(repo, { rootScripts: { 'probe:post': 'nmr fmt && echo done' } }),
      },
      {
        expected:
          '⚠️ package.json: `scripts.probe:post` reaches nmr through a shell (`nmr fmt && echo done`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script holds no step list: define `probe:post` in `.config/nmr.config.ts` and ' +
          'move the package-specific steps to a script of their own that the step list names, because a hook ' +
          'has no `:pre` or `:post` of its own.',
        scenario: 'a package.json entry',
        setup: (repo: string) => writePackageScripts(repo, { 'probe:post': 'nmr fmt && echo done' }),
      },
    ])('given a hook declared by $scenario, names no hook below it', async ({ expected, setup }, { tree }) => {
      setup(tree.dir);

      const { stderr } = await runNmrReadingStderr(['probe:post'], tree.dir);

      expect(stderr.trim()).toBe(expected);
    });

    it('spends one line on it', async ({ tree }) => {
      writeConfig(tree.dir, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr(['probe'], tree.dir);

      expect(stderr.split('\n').filter((line) => line.length > 0)).toHaveLength(1);
    });

    it.for([
      { args: ['-q', 'probe'], scenario: 'the -q flag' },
      { args: ['probe'], env: { NMR_COMMAND_VERBOSITY: 'quiet' }, scenario: 'an inherited verbosity' },
    ])('reports it although $scenario made the run quiet', async ({ args, env }, { tree }) => {
      writeConfig(tree.dir, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr(args, tree.dir, env);

      expect(stderr).toContain('reaches nmr through a shell');
    });

    it('leaves the exit code alone', async ({ tree }) => {
      writeConfig(tree.dir, { rootScripts: { probe: 'nmr fmt' } });

      const { exitCode } = await runNmrReadingStderr(['probe'], tree.dir);

      expect(exitCode).toBe(0);
    });

    it('reports a step reaching nmr through a launcher', async ({ tree }) => {
      writeConfig(tree.dir, { rootScripts: { probe: 'pnpm --recursive exec nmr build' } });

      const { stderr } = await runNmrReadingStderr(['probe'], tree.dir);

      expect(stderr).toContain('reaches nmr through a shell');
    });

    it.for([
      { args: ['fix'], scenario: 'a step list' },
      { args: ['-R', 'build'], scenario: 'the recursive delegate' },
      { args: ['-F', 'my-pkg', 'build'], scenario: 'the filter delegate' },
    ])('given $scenario, reports nothing', async ({ args }, { tree }) => {
      writeConfig(tree.dir, { rootScripts: { build: 'pnpm --recursive exec nmr build' } });

      const { stderr } = await runNmrReadingStderr(args, tree.dir);

      expect(stderr).toBe('');
    });
  });

  describe('a self-referential package.json entry', () => {
    // The remedy is a crossing's, the entry having to go either way; the consequence names what is lost here.
    it.for([
      {
        expected:
          'package.json: `scripts.build` re-invokes `nmr build` (`nmr build && rdy compile`), ' +
          'so nmr cannot run the steps it chains. ' +
          'Delete the entry and move the steps it adds to a `build:pre` or `build:post` script.',
        scenario: 'standing ahead of the steps it chains',
        scripts: { build: 'nmr build && rdy compile' },
      },
      {
        expected:
          'package.json: `scripts.build` re-invokes `nmr build` (`rdy compile && nmr build`), ' +
          'so nmr cannot run the steps it chains. ' +
          'Delete the entry and move the steps it adds to a `build:pre` or `build:post` script.',
        scenario: 'standing behind the steps it chains, which honouring would re-enter without bound',
        scripts: { build: 'rdy compile && nmr build' },
      },
      {
        expected:
          'package.json: `scripts.probe` re-invokes `nmr probe` (`nmr probe && tsx sync.ts`), ' +
          'so nmr cannot run the steps it chains. ' +
          'A `package.json` script holds no step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        scenario: 'naming a command the registry does not define',
        scripts: { probe: 'nmr probe && tsx sync.ts' },
      },
      {
        expected:
          'package.json: `scripts.build` re-invokes `nmr build` (`nmr build\\nrdy compile`), ' +
          'so nmr cannot run the steps it chains. ' +
          'Delete the entry and move the steps it adds to a `build:pre` or `build:post` script.',
        scenario: 'written across lines, whose entry quotes as the file holds it',
        scripts: { build: 'nmr build\nrdy compile' },
      },
    ])('given one $scenario, names the site and the edit that resolves it', async ({ expected, scripts }, { tree }) => {
      writePackageScripts(tree.dir, scripts);
      const command = Object.keys(scripts)[0] ?? '';

      await expect(runNmr([command], tree.dir)).rejects.toThrow(new UserError(expected));
    });

    it('runs nothing', async ({ tree }) => {
      writePackageScripts(tree.dir, { build: 'nmr build && rdy compile' });

      await expect(runNmr(['build'], tree.dir)).rejects.toThrow(UserError);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    // `--log` reads a recording rather than running one, so no step of the entry could go missing.
    it('is not rejected when the invocation only reads a recording', async ({ tree }) => {
      writePackageScripts(tree.dir, { build: 'nmr build && rdy compile' });

      const { stderr } = await runNmrReadingStderr(['--log', 'build'], tree.dir);

      expect(stderr).not.toContain('re-invokes');
    });

    it.for([
      { scenario: 'standing alone', scripts: { build: 'nmr build' } },
      { scenario: 'carrying trailing arguments, which declare no step', scripts: { build: 'nmr build --verbose' } },
    ])('reports nothing for one $scenario, running the registry entry instead', async ({ scripts }, { tree }) => {
      writePackageScripts(tree.dir, scripts);

      const { exitCode, stderr } = await runNmrReadingStderr(['build'], tree.dir);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(stepsFromCall()).toStrictEqual([{ kind: 'structural', argv: ['nmr', '-R', 'build'] }]);
    });

    // nmr wraps a hook in no hooks of its own, so naming `lint:post:pre` would name a script that never runs.
    it('tells a rejected hook to keep its steps, having no script below it to move them to', async ({ tree }) => {
      writePackageScripts(tree.dir, { 'lint:post': 'nmr lint:post && rdy compile' });

      await expect(runNmr(['lint:post'], tree.dir)).rejects.toThrow(
        new UserError(
          'package.json: `scripts.lint:post` re-invokes `nmr lint:post` (`nmr lint:post && rdy compile`), ' +
            'so nmr cannot run the steps it chains. ' +
            'Delete the re-invocation: `lint:post` runs the steps standing beside it.',
        ),
      );
    });

    // The default registry defines no hooks, so a dropped hook is the common case rather than a corner of it.
    it('wraps a rejected hook the registry does not define, so its own process reports it', async ({ tree }) => {
      writePackageScripts(tree.dir, { 'lint:post': 'nmr lint:post && rdy compile' });

      const { exitCode } = await runNmrReadingStderr(['lint'], tree.dir);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'opaque', command: 'eslint --fix .' },
        { kind: 'structural', argv: ['nmr', 'lint:post'] },
      ]);
      expect(exitCode).toBe(0);
    });
  });

  describe('verdicts', () => {
    it('reports a pass, naming the scope the command ran at', async ({ tree }) => {
      const { stdout } = await runNmrReadingStdout(['typecheck'], tree.dir);

      expect(stdout).toMatch(
        new RegExp(String.raw`^✅ ${path.basename(tree.dir)}: typecheck: passed in [\d.]+s` + '\n$'),
      );
    });

    it('reports a failure with the exit code, which separates an interrupt from a real failure', async ({ tree }) => {
      mockedRunSteps.mockResolvedValue({ exitCode: 130 });

      const { exitCode, stdout } = await runNmrReadingStdout(['typecheck'], tree.dir);

      expect(exitCode).toBe(130);
      expect(stdout).toContain('❌');
      expect(stdout).toContain('typecheck: failed in');
      expect(stdout).toContain('(exit 130)');
    });

    it('reports in quiet mode, which withholds the command output and not the words nmr writes itself', async ({
      tree,
    }) => {
      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('✅');
    });

    it('reports the same pass as a JSON object, and writes no prose line beside it', async ({ tree }) => {
      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], tree.dir);
      const parsed: unknown = JSON.parse(stdout);

      expect(stdout.endsWith('\n')).toBe(true);
      expect(parsed).toMatchObject({ command: 'typecheck', outcome: 'passed', scope: path.basename(tree.dir) });
    });

    it('reports a skip as a JSON object naming why it ran nothing', async ({ tree }) => {
      writePackageScripts(tree.dir, { typecheck: '' });

      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], tree.dir);
      const parsed: unknown = JSON.parse(stdout);

      expect(parsed).toMatchObject({ command: 'typecheck', outcome: 'no-op', reason: 'empty-override' });
    });

    // The override notice is the one message a quiet run withholds, and a machine-readable run is quiet.
    it('leaves stdout carrying the object alone where a package script stands in for a built-in', async ({ tree }) => {
      writePackageScripts(tree.dir, { typecheck: 'echo standing-in' });

      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], tree.dir);

      expect(stdout).not.toContain('📦');
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    });

    it.for([
      { args: ['typecheck:pre'], scenario: 'a hook leaf, whose chain the level above reports on' },
      { args: ['-R', 'typecheck'], scenario: 'the recursive delegate, whose scopes each report' },
      { args: ['-F', 'my-pkg', 'typecheck'], scenario: 'the filter delegate, whose scope reports' },
    ])('given $scenario, reports no verdict', async ({ args }, { tree }) => {
      writeConfig(tree.dir, { rootScripts: { 'typecheck:pre': 'echo hi' } });

      const { stdout } = await runNmrReadingStdout(args, tree.dir);

      expect(stdout).toBe('');
    });

    it('reports nothing for a command the registry does not define, having none to report on', async ({ tree }) => {
      const { exitCode, stdout } = await runNmrReadingStdout(['nonexistent'], tree.dir, { NMR_RUN_IF_PRESENT: '1' });

      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
    });

    it.for([
      { expected: 'the override is empty', script: '', scenario: 'an empty override' },
      { expected: 'the override is a no-op', script: ':', scenario: 'a no-op override' },
    ])('given $scenario, reports a skip distinguishable from a pass', async ({ expected, script }, { tree }) => {
      writePackageScripts(tree.dir, { typecheck: script });

      const { exitCode, stdout } = await runNmrReadingStdout(['typecheck'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(`⛔ ${path.basename(tree.dir)}: typecheck: skipped, ${expected}\n`);
    });

    // A verdict is a report on a run, and `--log` makes none: the reader gets a refusal instead.
    it.for([
      { scenario: 'an empty override', script: '' },
      { scenario: 'a no-op override', script: ':' },
    ])('given $scenario, reports no skip verdict under --log', async ({ script }, { tree }) => {
      writePackageScripts(tree.dir, { typecheck: script });

      const { exitCode, stdout } = await runNmrReadingStdout(['--log', 'typecheck'], tree.dir);
      const { stderr } = await runNmrReadingStderr(['--log', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('no recording');
    });

    it('reports the skip in quiet mode, where a silent exit 0 would read as a pass', async ({ tree }) => {
      writePackageScripts(tree.dir, { typecheck: ':' });

      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('⛔');
    });
  });
});

// region | Helpers

/** Runs the CLI in-process against `cwd`, discarding both output streams. */
async function runNmr(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Promise<{ exitCode: number }> {
  return runCli({ args, cwd, env, stderr: new PassThrough(), stdout: new PassThrough() });
}

/** Runs the CLI in-process against `cwd`, returning what it wrote to stdout. */
async function runNmrReadingStdout(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stdout: string }> {
  const chunks: Buffer[] = [];
  const stdout = new PassThrough();
  stdout.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const { exitCode } = await runCli({ args, cwd, env, stderr: new PassThrough(), stdout });

  return { exitCode, stdout: Buffer.concat(chunks).toString('utf8') };
}

/** Runs the CLI in-process against `cwd`, returning what it wrote to stderr. */
async function runNmrReadingStderr(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stderr: string }> {
  const chunks: Buffer[] = [];
  const stderr = new PassThrough();
  stderr.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const { exitCode } = await runCli({ args, cwd, env, stderr, stdout: new PassThrough() });

  return { exitCode, stderr: Buffer.concat(chunks).toString('utf8') };
}

/** Reads the step list the runner was handed. */
function stepsFromCall(): readonly Step[] | undefined {
  return mockedRunSteps.mock.calls[0]?.[0];
}

/** Writes the tier-3 scripts of the monorepo root's own `package.json`. */
function writePackageScripts(repo: string, scripts: Record<string, string>): void {
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts }));
}

/** Writes a monorepo-root config, which is the only tier that carries `devBin` and the script registries. */
function writeConfig(repo: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.join(repo, '.config'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.config', 'nmr.config.ts'), `export default ${JSON.stringify(config)};\n`);
}

// endregion | Helpers
