import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
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

    it.each([
      {
        args: ['-F', 'my-pkg', '--log', 'test'],
        expected: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', '--log', 'test'],
      },
      { args: ['-R', '--log', 'test'], expected: ['pnpm', '--recursive', 'exec', 'nmr', '--log', 'test'] },
    ])('carries `--log` into the delegate, ahead of the command name', async ({ args, expected }) => {
      await runNmr(args, repo);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'structural', argv: expected }]);
    });

    // A fan-out asks every selected scope, so a scope that never ran the command is a gap in a survey rather
    // than a failure of one.
    it('tells a `--log` filter delegate to pass over a scope with nothing to show', async () => {
      await runNmr(['-F', 'my-pkg', '--log', 'test'], repo);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ NMR_RUN_IF_PRESENT: '1' });
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
    it('binds to every element of a composite and never to a hook', async () => {
      writeConfig(repo, { rootScripts: { 'fix:post': 'echo done', 'fix:pre': 'echo starting' } });

      await runNmr(['fix', '--dry-run'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'fix:pre'] },
        { kind: 'structural', argv: ['nmr', 'lint', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fmt', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fix:post'] },
      ]);
    });

    it('leaves a declining element unnarrowed', async () => {
      writeConfig(repo, {
        rootScripts: { verify: [{ run: 'build', declinesArgs: true }, 'lint'] },
      });

      await runNmr(['verify', 'src/'], repo);

      expect(stepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'build'], declinesArgs: true },
        { kind: 'structural', argv: ['nmr', 'lint', 'src/'] },
      ]);
    });

    it('runs nothing when no element accepts them, naming the command', async () => {
      writeConfig(repo, {
        rootScripts: {
          verify: [
            { run: 'build', declinesArgs: true },
            { run: 'lint', declinesArgs: true },
          ],
        },
      });

      const { exitCode, stderr } = await runNmrReadingStderr(['verify', 'src/'], repo);

      expect(exitCode).toBe(1);
      expect(stepsFromCall()).toBeUndefined();
      expect(stderr).toContain('`verify` takes no trailing arguments');
    });

    it('binds to a string script as shell-quoted text', async () => {
      await runNmr(['lint', '--max-warnings', '0'], repo);

      expect(stepsFromCall()).toStrictEqual([{ kind: 'opaque', command: "eslint --fix . '--max-warnings' '0'" }]);
    });

    it('quotes a structural argument once, where the chain string quotes only what the shell would act on', async () => {
      await runNmr(['fix', '-t', 'a b'], repo);

      expect(stepsFromCall()?.at(-1)).toStrictEqual({ kind: 'structural', argv: ['nmr', 'fmt', '-t', 'a b'] });
      expect(renderChain(stepsFromCall() ?? [])).toBe("nmr lint -t 'a b' && nmr fmt -t 'a b'");
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

    // The config is loaded after this point, so reaching it would make an invalid one break an unrelated flag.
    it('reports the version against a repo whose config cannot be loaded', async () => {
      fs.mkdirSync(path.join(repo, '.config'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.config', 'nmr.config.ts'), `export default { bild: {} };\n`);

      const { exitCode, stdout } = await runNmrReadingStdout(['--version'], repo);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).not.toBe('');
    });

    it('takes the verbosity the repo configured', async () => {
      writeConfig(repo, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], repo);

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('lets an inherited full outrank a quiet the repo configured', async () => {
      writeConfig(repo, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], repo, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('goes quiet under a harness on the shipped list', async () => {
      await runNmr(['fix'], repo, { CLAUDECODE: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('goes quiet under a harness the repo added', async () => {
      writeConfig(repo, { output: { extraAgentEnvVars: ['MY_CLI'] } });

      await runNmr(['fix'], repo, { MY_CLI: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // Declining detection is what a configured `full` says, so no switch of its own exists to turn it off.
    it('stays loud under a detected harness when the repo configured full', async () => {
      writeConfig(repo, { output: { commandVerbosity: 'full' } });

      await runNmr(['fix'], repo, { CLAUDECODE: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('leaves an unrecognized harness exactly as loud as it is today', async () => {
      await runNmr(['fix'], repo, { SOME_OTHER_CLI: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });
  });

  describe('report format', () => {
    it.each([
      { args: ['-F', 'my-pkg', 'build'], expected: 'text', scenario: 'a run passing no flag' },
      { args: ['--json', '-F', 'my-pkg', 'build'], expected: 'json', scenario: 'a run passing the flag' },
    ])('given $scenario, hands the resolved format to every process below it', async ({ args, expected }) => {
      await runNmr(args, repo);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: expected });
    });

    it('lets an inherited json reach a run that passed no flag', async () => {
      await runNmr(['-F', 'my-pkg', 'build'], repo, { [REPORT_FORMAT_ENV_VAR]: 'json' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    it('lets the flag outrank an inherited text', async () => {
      await runNmr(['--json', 'fix'], repo, { [REPORT_FORMAT_ENV_VAR]: 'text' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    // Stdout carries the objects and nothing else may, so the loudness ladder does not get to fill it.
    it.each([
      { env: {}, scenario: 'a run with nothing set' },
      { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'full' }, scenario: 'an inherited full' },
    ])('withholds the command output given $scenario', async ({ env }) => {
      await runNmr(['--json', 'fix'], repo, env);

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('carries the quiet a machine-readable run forces to every process below it', async () => {
      await runNmr(['--json', '-F', 'my-pkg', 'build'], repo, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which this does not.
    it('renders the same chain string in either format', async () => {
      await runNmr(['fix'], repo);
      const text = renderChain(stepsFromCall() ?? []);

      mockedRunSteps.mockClear();
      await runNmr(['--json', 'fix'], repo);

      expect(renderChain(stepsFromCall() ?? [])).toBe(text);
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
    it('propagates what the sequence returned', async () => {
      mockedRunSteps.mockResolvedValue({ exitCode: 2 });

      await expect(runNmr(['fix'], repo)).resolves.toStrictEqual({ exitCode: 2 });
    });
  });

  describe('the shelled-nmr boundary', () => {
    // The remedy follows from where the step was declared, so each origin gets the edit that resolves it.
    it.each([
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
    ])('given $scenario, names the site and the edit that resolves it', async ({ command, expected, setup }) => {
      setup(repo);

      const { stderr } = await runNmrReadingStderr([command], repo);

      expect(stderr.trim()).toBe(expected);
    });

    it('spends one line on it', async () => {
      writeConfig(repo, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr(['probe'], repo);

      expect(stderr.split('\n').filter((line) => line.length > 0)).toHaveLength(1);
    });

    it.each([
      { args: ['-q', 'probe'], scenario: 'the -q flag' },
      { args: ['probe'], env: { NMR_COMMAND_VERBOSITY: 'quiet' }, scenario: 'an inherited verbosity' },
    ])('reports it although $scenario made the run quiet', async ({ args, env }) => {
      writeConfig(repo, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr(args, repo, env);

      expect(stderr).toContain('reaches nmr through a shell');
    });

    it('leaves the exit code alone', async () => {
      writeConfig(repo, { rootScripts: { probe: 'nmr fmt' } });

      const { exitCode } = await runNmrReadingStderr(['probe'], repo);

      expect(exitCode).toBe(0);
    });

    it('reports a step reaching nmr through a launcher', async () => {
      writeConfig(repo, { rootScripts: { probe: 'pnpm --recursive exec nmr build' } });

      const { stderr } = await runNmrReadingStderr(['probe'], repo);

      expect(stderr).toContain('reaches nmr through a shell');
    });

    it.each([
      { args: ['fix'], scenario: 'a step list' },
      { args: ['-R', 'build'], scenario: 'the recursive delegate' },
      { args: ['-F', 'my-pkg', 'build'], scenario: 'the filter delegate' },
    ])('given $scenario, reports nothing', async ({ args }) => {
      writeConfig(repo, { rootScripts: { build: 'pnpm --recursive exec nmr build' } });

      const { stderr } = await runNmrReadingStderr(args, repo);

      expect(stderr).toBe('');
    });
  });

  describe('verdicts', () => {
    it('reports a pass, naming the scope the command ran at', async () => {
      const { stdout } = await runNmrReadingStdout(['typecheck'], repo);

      expect(stdout).toMatch(new RegExp(String.raw`^✅ ${path.basename(repo)}: typecheck: passed in [\d.]+s` + '\n$'));
    });

    it('reports a failure with the exit code, which separates an interrupt from a real failure', async () => {
      mockedRunSteps.mockResolvedValue({ exitCode: 130 });

      const { exitCode, stdout } = await runNmrReadingStdout(['typecheck'], repo);

      expect(exitCode).toBe(130);
      expect(stdout).toContain('❌');
      expect(stdout).toContain('typecheck: failed in');
      expect(stdout).toContain('(exit 130)');
    });

    it('reports in quiet mode, which withholds the command output and not the words nmr writes itself', async () => {
      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], repo);

      expect(stdout).toContain('✅');
    });

    it('reports the same pass as a JSON object, and writes no prose line beside it', async () => {
      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], repo);
      const parsed: unknown = JSON.parse(stdout);

      expect(stdout.endsWith('\n')).toBe(true);
      expect(parsed).toMatchObject({ command: 'typecheck', outcome: 'passed', scope: path.basename(repo) });
    });

    it('reports a skip as a JSON object naming why it ran nothing', async () => {
      writePackageScripts(repo, { typecheck: '' });

      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], repo);
      const parsed: unknown = JSON.parse(stdout);

      expect(parsed).toMatchObject({ command: 'typecheck', outcome: 'no-op', reason: 'empty-override' });
    });

    // The override notice is the one message a quiet run withholds, and a machine-readable run is quiet.
    it('leaves stdout carrying the object alone where a package script stands in for a built-in', async () => {
      writePackageScripts(repo, { typecheck: 'echo standing-in' });

      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], repo);

      expect(stdout).not.toContain('📦');
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    });

    it.each([
      { args: ['typecheck:pre'], scenario: 'a hook leaf, whose chain the level above reports on' },
      { args: ['-R', 'typecheck'], scenario: 'the recursive delegate, whose scopes each report' },
      { args: ['-F', 'my-pkg', 'typecheck'], scenario: 'the filter delegate, whose scope reports' },
    ])('given $scenario, reports no verdict', async ({ args }) => {
      writeConfig(repo, { rootScripts: { 'typecheck:pre': 'echo hi' } });

      const { stdout } = await runNmrReadingStdout(args, repo);

      expect(stdout).toBe('');
    });

    it('reports nothing for a command the registry does not define, having none to report on', async () => {
      const { exitCode, stdout } = await runNmrReadingStdout(['nonexistent'], repo, { NMR_RUN_IF_PRESENT: '1' });

      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
    });

    it.each([
      { expected: 'the override is empty', script: '', scenario: 'an empty override' },
      { expected: 'the override is a no-op', script: ':', scenario: 'a no-op override' },
    ])('given $scenario, reports a skip distinguishable from a pass', async ({ expected, script }) => {
      writePackageScripts(repo, { typecheck: script });

      const { exitCode, stdout } = await runNmrReadingStdout(['typecheck'], repo);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(`⛔ ${path.basename(repo)}: typecheck: skipped, ${expected}\n`);
    });

    // A verdict is a report on a run, and `--log` makes none: the reader gets a refusal instead.
    it.each([
      { scenario: 'an empty override', script: '' },
      { scenario: 'a no-op override', script: ':' },
    ])('given $scenario, reports no skip verdict under --log', async ({ script }) => {
      writePackageScripts(repo, { typecheck: script });

      const { exitCode, stdout } = await runNmrReadingStdout(['--log', 'typecheck'], repo);
      const { stderr } = await runNmrReadingStderr(['--log', 'typecheck'], repo);

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('no recording');
    });

    it('reports the skip in quiet mode, where a silent exit 0 would read as a pass', async () => {
      writePackageScripts(repo, { typecheck: ':' });

      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], repo);

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
