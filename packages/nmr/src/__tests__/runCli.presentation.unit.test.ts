import path from 'node:path';
import { PassThrough } from 'node:stream';

import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { readFilterSelection } from '../helpers/filter-selection.ts';
import { OUTPUT_STYLE_ENV_VAR, OUTPUT_STYLE_FLAG } from '../output-style.ts';
import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import { renderChain } from '../steps.ts';
import { createWorkspaceTree } from '../test-utils/run-cli-fixtures.ts';
import {
  readStepsFromCall,
  runNmr,
  runNmrReadingStderr,
  runNmrReadingStdout,
  writeConfig,
  writePackageScripts,
} from '../test-utils/run-cli-harness.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

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
const mockedReadFilterSelection = vi.mocked(readFilterSelection);

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createWorkspaceTree()),
);

describe(runCli, () => {
  beforeEach(() => {
    mockedRunSteps.mockReset();
    mockedRunSteps.mockResolvedValue({ exitCode: 0 });
    mockedReadFilterSelection.mockReset();
    mockedReadFilterSelection.mockReturnValue('single');
  });

  describe('verbosity', () => {
    it.for([
      { args: ['-F', 'my-pkg', 'build'], expectedVerbosity: 'full', scenario: 'a loud run' },
      { args: ['-q', '-F', 'my-pkg', 'build'], expectedVerbosity: 'quiet', scenario: 'a quiet run' },
    ])(
      'given $scenario, hands the resolved verbosity to every process below it',
      async ({ args, expectedVerbosity }, { tree }) => {
        await runNmr(args, tree.dir);

        expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: expectedVerbosity });
      },
    );

    it('lets an inherited quiet apply to a run that did not pass a flag', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which `-q` does not.
    it('renders the same chain string loud and quiet', async ({ tree }) => {
      await runNmr(['fix'], tree.dir);
      const loudChain = renderChain(readStepsFromCall() ?? []);

      mockedRunSteps.mockClear();
      await runNmr(['-q', 'fix'], tree.dir);

      expect(renderChain(readStepsFromCall() ?? [])).toBe(loudChain);
    });

    it.for([
      { args: ['--version'], scenario: 'the version flag' },
      { args: ['--help'], scenario: 'the help flag' },
      { args: ['build'], scenario: 'a command' },
    ])('given an unrecognized inherited value, rejects $scenario before doing anything', async ({ args }, { tree }) => {
      const stdout = new PassThrough();
      const writtenChunks: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => {
        writtenChunks.push(chunk);
      });

      const { exitCode } = await runCli({
        args,
        cwd: tree.dir,
        env: { [COMMAND_VERBOSITY_ENV_VAR]: 'silent' },
        stderr: new PassThrough(),
        stdout,
      });

      expect(exitCode).toBe(1);
      expect(Buffer.concat(writtenChunks)).toHaveLength(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    // The config is loaded after this point, so reaching it would make an invalid one break an unrelated flag.
    it('reports the version against a repo whose config cannot be loaded', async ({ tree }) => {
      tree.write('.config/nmr.config.ts', `export default { bild: {} };\n`);

      const { exitCode, stdout } = await runNmrReadingStdout(['--version'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).not.toBe('');
    });

    it('takes the verbosity configured by the repo', async ({ tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('lets an inherited full outrank a quiet configured by the repo', async ({ tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('goes quiet under a harness on the built-in list', async ({ tree }) => {
      await runNmr(['fix'], tree.dir, { CLAUDECODE: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('goes quiet under a harness added by the repo', async ({ tree }) => {
      writeConfig(tree, { output: { extraAgentEnvVars: ['MY_CLI'] } });

      await runNmr(['fix'], tree.dir, { MY_CLI: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // A configured `full` declines detection, so nmr does not provide a separate switch to turn detection off.
    it('stays loud under a detected harness when the repo configured full', async ({ tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'full' } });

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
      { args: ['-F', 'my-pkg', 'build'], expectedFormat: 'text', scenario: 'a run without the flag' },
      { args: ['--json', '-F', 'my-pkg', 'build'], expectedFormat: 'json', scenario: 'a run passing the flag' },
    ])(
      'given $scenario, hands the resolved format to every process below it',
      async ({ args, expectedFormat }, { tree }) => {
        await runNmr(args, tree.dir);

        expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: expectedFormat });
      },
    );

    it('lets an inherited json apply to a run that did not pass the flag', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir, { [REPORT_FORMAT_ENV_VAR]: 'json' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    it('lets the flag outrank an inherited text', async ({ tree }) => {
      await runNmr(['--json', 'fix'], tree.dir, { [REPORT_FORMAT_ENV_VAR]: 'text' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    // Stdout contains the objects alone, so the verbosity level cannot add output to it.
    it.for([
      { env: {}, scenario: 'a run with nothing set' },
      { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'full' }, scenario: 'an inherited full' },
    ])('withholds the command output given $scenario', async ({ env }, { tree }) => {
      await runNmr(['--json', 'fix'], tree.dir, env);

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('passes the quiet forced by a machine-readable run to every process below it', async ({ tree }) => {
      await runNmr(['--json', '-F', 'my-pkg', 'build'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which this does not.
    it('renders the same chain string in either format', async ({ tree }) => {
      await runNmr(['fix'], tree.dir);
      const text = renderChain(readStepsFromCall() ?? []);

      mockedRunSteps.mockClear();
      await runNmr(['--json', 'fix'], tree.dir);

      expect(renderChain(readStepsFromCall() ?? [])).toBe(text);
    });

    it.for([
      { args: ['--version'], scenario: 'the version flag' },
      { args: ['--help'], scenario: 'the help flag' },
      { args: ['build'], scenario: 'a command' },
    ])('given an unrecognized inherited value, rejects $scenario before doing anything', async ({ args }, { tree }) => {
      const stdout = new PassThrough();
      const writtenChunks: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => {
        writtenChunks.push(chunk);
      });

      const { exitCode } = await runCli({
        args,
        cwd: tree.dir,
        env: { [REPORT_FORMAT_ENV_VAR]: 'ndjson' },
        stderr: new PassThrough(),
        stdout,
      });

      expect(exitCode).toBe(1);
      expect(Buffer.concat(writtenChunks)).toHaveLength(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });
  });

  describe('output style', () => {
    it.for([
      {
        args: ['-F', 'my-pkg', 'build'],
        expectedStyle: 'plain',
        scenario: 'a run without the flag, whose streams are pipes',
      },
      { args: [OUTPUT_STYLE_FLAG, 'rich', '-F', 'my-pkg', 'build'], expectedStyle: 'rich', scenario: 'the flag' },
      {
        args: [`${OUTPUT_STYLE_FLAG}=rich`, '-F', 'my-pkg', 'build'],
        expectedStyle: 'rich',
        scenario: 'the flag written as an assignment',
      },
    ])(
      'given $scenario, hands the resolved style to every process below it',
      async ({ args, expectedStyle }, { tree }) => {
        await runNmr(args, tree.dir);

        expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: expectedStyle });
      },
    );

    it('lets an inherited rich apply to a run that did not pass the flag', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir, { [OUTPUT_STYLE_ENV_VAR]: 'rich' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: 'rich' });
    });

    it('lets the flag outrank an inherited rich', async ({ tree }) => {
      await runNmr([OUTPUT_STYLE_FLAG, 'plain', '-F', 'my-pkg', 'build'], tree.dir, {
        [OUTPUT_STYLE_ENV_VAR]: 'rich',
      });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: 'plain' });
    });

    // Never `auto`: a child on a pipe would otherwise detect plain rather than following the parent.
    it('exports a resolved style for an inherited auto', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir, { [OUTPUT_STYLE_ENV_VAR]: 'auto' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: 'plain' });
    });

    it.for([
      { args: [OUTPUT_STYLE_FLAG], scenario: 'a flag at the end of the arguments' },
      { args: [`${OUTPUT_STYLE_FLAG}=`], scenario: 'an empty assignment' },
    ])('rejects $scenario', async ({ args }, { tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(args, tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(OUTPUT_STYLE_FLAG);
    });

    it.for([
      { args: ['--version'], scenario: 'the version flag' },
      { args: ['--help'], scenario: 'the help flag' },
      { args: ['build'], scenario: 'a command' },
    ])('given an unrecognized inherited value, rejects $scenario before doing anything', async ({ args }, { tree }) => {
      const stdout = new PassThrough();
      const writtenChunks: Buffer[] = [];
      stdout.on('data', (chunk: Buffer) => {
        writtenChunks.push(chunk);
      });

      const { exitCode } = await runCli({
        args,
        cwd: tree.dir,
        env: { [OUTPUT_STYLE_ENV_VAR]: 'fancy' },
        stderr: new PassThrough(),
        stdout,
      });

      expect(exitCode).toBe(1);
      expect(Buffer.concat(writtenChunks)).toHaveLength(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    it('names the flag and every accepted value when it rejects the flag', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr([OUTPUT_STYLE_FLAG, 'fancy', 'fix'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(OUTPUT_STYLE_FLAG);
      expect(stderr).toContain('auto, plain, rich');
    });
  });

  describe('exit codes', () => {
    it('propagates what the sequence returned', async ({ tree }) => {
      mockedRunSteps.mockResolvedValue({ exitCode: 2 });

      await expect(runNmr(['fix'], tree.dir)).resolves.toStrictEqual({ exitCode: 2 });
    });
  });

  describe('verdicts', () => {
    it('reports a pass, naming the scope at which the command ran', async ({ tree }) => {
      const { stdout } = await runNmrReadingStdout(['typecheck'], tree.dir);

      expect(stdout).toMatch(
        new RegExp(String.raw`^PASS ${path.basename(tree.dir)}: typecheck: passed in [\d.]+s` + '\n$'),
      );
    });

    it('reports a pass in emoji when the invocation asked for rich', async ({ tree }) => {
      const { stdout } = await runNmrReadingStdout([OUTPUT_STYLE_FLAG, 'rich', 'typecheck'], tree.dir);

      expect(stdout).toMatch(
        new RegExp(String.raw`^✅ ${path.basename(tree.dir)}: typecheck: passed in [\d.]+s` + '\n$'),
      );
    });

    it('reports a failure with the exit code, which separates an interrupt from a real failure', async ({ tree }) => {
      mockedRunSteps.mockResolvedValue({ exitCode: 130 });

      const { exitCode, stdout } = await runNmrReadingStdout(['typecheck'], tree.dir);

      expect(exitCode).toBe(130);
      expect(stdout).toContain('FAIL');
      expect(stdout).toContain('typecheck: failed in');
      expect(stdout).toContain('(exit 130)');
    });

    it('reports in quiet mode, which withholds the command output and not the words that nmr writes itself', async ({
      tree,
    }) => {
      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('PASS');
    });

    it('reports the same pass as a JSON object, and does not write a prose line beside it', async ({ tree }) => {
      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], tree.dir);
      const parsedVerdict: unknown = JSON.parse(stdout);

      expect(stdout.endsWith('\n')).toBe(true);
      expect(parsedVerdict).toMatchObject({ command: 'typecheck', outcome: 'passed', scope: path.basename(tree.dir) });
    });

    it('reports a skip as a JSON object naming why it ran nothing', async ({ tree }) => {
      writePackageScripts(tree, { typecheck: '' });

      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], tree.dir);
      const parsedVerdict: unknown = JSON.parse(stdout);

      expect(parsedVerdict).toMatchObject({ command: 'typecheck', outcome: 'no-op', reason: 'empty-override' });
    });

    // The override notice is the one message that a quiet run withholds, and a machine-readable run is quiet.
    it('leaves stdout containing the object alone when a package script stands in for a built-in', async ({ tree }) => {
      writePackageScripts(tree, { typecheck: 'echo standing-in' });

      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], tree.dir);

      expect(stdout).not.toContain('Using override script');
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    });

    it.for([
      { args: ['typecheck:pre'], scenario: 'a hook leaf, whose chain the level above reports on' },
      { args: ['-R', 'typecheck'], scenario: 'the recursive delegate, whose scopes each report' },
      { args: ['-F', 'my-pkg', 'typecheck'], scenario: 'the filter delegate, whose scope reports' },
    ])('given $scenario, does not report a verdict', async ({ args }, { tree }) => {
      writeConfig(tree, { rootScripts: { 'typecheck:pre': 'echo hi' } });

      const { stdout } = await runNmrReadingStdout(args, tree.dir);

      expect(stdout).toBe('');
    });

    it('reports nothing for a command that the registry does not define, having none to report on', async ({
      tree,
    }) => {
      const { exitCode, stdout } = await runNmrReadingStdout(['nonexistent'], tree.dir, { NMR_RUN_IF_PRESENT: '1' });

      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
    });

    it.for([
      { expectedReason: 'the override is empty', script: '', scenario: 'an empty override' },
      { expectedReason: 'the override is a no-op', script: ':', scenario: 'a no-op override' },
    ])('given $scenario, reports a skip distinguishable from a pass', async ({ expectedReason, script }, { tree }) => {
      writePackageScripts(tree, { typecheck: script });

      const { exitCode, stdout } = await runNmrReadingStdout(['typecheck'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(`NOOP ${path.basename(tree.dir)}: typecheck: skipped, ${expectedReason}\n`);
    });

    // A verdict is a report on a run, and `--log` makes none: the reader gets a refusal instead.
    it.for([
      { scenario: 'an empty override', script: '' },
      { scenario: 'a no-op override', script: ':' },
    ])('given $scenario, does not report a skip verdict under --log', async ({ script }, { tree }) => {
      writePackageScripts(tree, { typecheck: script });

      const { exitCode, stdout } = await runNmrReadingStdout(['--log', 'typecheck'], tree.dir);
      const { stderr } = await runNmrReadingStderr(['--log', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('no recording');
    });

    it('reports the skip in quiet mode, in which a silent exit 0 would read as a pass', async ({ tree }) => {
      writePackageScripts(tree, { typecheck: ':' });

      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('NOOP');
    });
  });
});
