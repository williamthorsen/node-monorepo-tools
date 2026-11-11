import path from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect } from 'vitest';

import { OUTPUT_STYLE_ENV_VAR, OUTPUT_STYLE_FLAG } from '../output-style.ts';
import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { runCli } from '../runCli.ts';
import { renderChain } from '../steps.ts';
import { it } from '../test-utils/run-cli-fixtures.ts';
import { writeConfig, writePackageScripts } from '../test-utils/run-cli-harness.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

describe(runCli, () => {
  describe('verbosity', () => {
    it.for([
      { args: ['-F', 'my-pkg', 'build'], expectedVerbosity: 'full', scenario: 'a loud run' },
      { args: ['-q', '-F', 'my-pkg', 'build'], expectedVerbosity: 'quiet', scenario: 'a quiet run' },
    ])(
      'given $scenario, hands the resolved verbosity to every process below it',
      async ({ args, expectedVerbosity }, { nmr, tree }) => {
        await nmr.run(args, tree.dir);

        expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: expectedVerbosity });
      },
    );

    it('lets an inherited quiet apply to a run that did not pass a flag', async ({ nmr, tree }) => {
      await nmr.run(['-F', 'my-pkg', 'build'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which `-q` does not.
    it('renders the same chain string loud and quiet', async ({ nmr, tree }) => {
      await nmr.run(['fix'], tree.dir);
      const loudChain = renderChain(nmr.readStepsFromCall() ?? []);

      nmr.runSteps.mockClear();
      await nmr.run(['-q', 'fix'], tree.dir);

      expect(renderChain(nmr.readStepsFromCall() ?? [])).toBe(loudChain);
    });

    it.for([
      { args: ['build'], scenario: 'a command' },
      { args: ['-F', 'my-pkg', 'build'], scenario: 'a filtered command' },
    ])(
      'given an unrecognized inherited value, rejects $scenario before doing anything',
      async ({ args }, { nmr, tree }) => {
        const stdout = new PassThrough();
        const writtenChunks: Buffer[] = [];
        stdout.on('data', (chunk: Buffer) => {
          writtenChunks.push(chunk);
        });

        const { exitCode } = await runCli({
          ...nmr.deps,
          args,
          cwd: tree.dir,
          env: { [COMMAND_VERBOSITY_ENV_VAR]: 'silent' },
          stderr: new PassThrough(),
          stdout,
        });

        expect(exitCode).toBe(2);
        expect(Buffer.concat(writtenChunks)).toHaveLength(0);
        expect(nmr.runSteps).not.toHaveBeenCalled();
      },
    );

    // The config is loaded after this point, so reaching it would make an invalid one break an unrelated flag.
    it('reports the version against a repo whose config cannot be loaded', async ({ nmr, tree }) => {
      tree.write('.config/nmr.config.ts', `export default { bild: {} };\n`);

      const { exitCode, stdout } = await nmr.runReadingStdout(['--version'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).not.toBe('');
    });

    it('takes the verbosity configured by the repo', async ({ nmr, tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'quiet' } });

      await nmr.run(['fix'], tree.dir);

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('lets an inherited full outrank a quiet configured by the repo', async ({ nmr, tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'quiet' } });

      await nmr.run(['fix'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('goes quiet under a harness on the built-in list', async ({ nmr, tree }) => {
      await nmr.run(['fix'], tree.dir, { CLAUDECODE: '1' });

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('goes quiet under a harness added by the repo', async ({ nmr, tree }) => {
      writeConfig(tree, { output: { extraAgentEnvVars: ['MY_CLI'] } });

      await nmr.run(['fix'], tree.dir, { MY_CLI: '1' });

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // A configured `full` declines detection, so nmr does not provide a separate switch to turn detection off.
    it('stays loud under a detected harness when the repo configured full', async ({ nmr, tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'full' } });

      await nmr.run(['fix'], tree.dir, { CLAUDECODE: '1' });

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('leaves an unrecognized harness exactly as loud as it is today', async ({ nmr, tree }) => {
      await nmr.run(['fix'], tree.dir, { SOME_OTHER_CLI: '1' });

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });
  });

  describe('report format', () => {
    it.for([
      { args: ['-F', 'my-pkg', 'build'], expectedFormat: 'text', scenario: 'a run without the flag' },
      { args: ['--json', '-F', 'my-pkg', 'build'], expectedFormat: 'json', scenario: 'a run passing the flag' },
    ])(
      'given $scenario, hands the resolved format to every process below it',
      async ({ args, expectedFormat }, { nmr, tree }) => {
        await nmr.run(args, tree.dir);

        expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: expectedFormat });
      },
    );

    it('lets an inherited json apply to a run that did not pass the flag', async ({ nmr, tree }) => {
      await nmr.run(['-F', 'my-pkg', 'build'], tree.dir, { [REPORT_FORMAT_ENV_VAR]: 'json' });

      expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    it('lets the flag outrank an inherited text', async ({ nmr, tree }) => {
      await nmr.run(['--json', 'fix'], tree.dir, { [REPORT_FORMAT_ENV_VAR]: 'text' });

      expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: 'json' });
    });

    // Stdout contains the objects alone, so the verbosity level cannot add output to it.
    it.for([
      { env: {}, scenario: 'a run with nothing set' },
      { env: { [COMMAND_VERBOSITY_ENV_VAR]: 'full' }, scenario: 'an inherited full' },
    ])('withholds the command output given $scenario', async ({ env }, { nmr, tree }) => {
      await nmr.run(['--json', 'fix'], tree.dir, env);

      expect(nmr.runSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('passes the quiet forced by a machine-readable run to every process below it', async ({ nmr, tree }) => {
      await nmr.run(['--json', '-F', 'my-pkg', 'build'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [COMMAND_VERBOSITY_ENV_VAR]: 'quiet' });
    });

    // A flag belongs in the rendered string exactly when it changes what the command does, which this does not.
    it('renders the same chain string in either format', async ({ nmr, tree }) => {
      await nmr.run(['fix'], tree.dir);
      const text = renderChain(nmr.readStepsFromCall() ?? []);

      nmr.runSteps.mockClear();
      await nmr.run(['--json', 'fix'], tree.dir);

      expect(renderChain(nmr.readStepsFromCall() ?? [])).toBe(text);
    });

    it.for([
      { args: ['build'], scenario: 'a command' },
      { args: ['-F', 'my-pkg', 'build'], scenario: 'a filtered command' },
    ])(
      'given an unrecognized inherited value, rejects $scenario before doing anything',
      async ({ args }, { nmr, tree }) => {
        const stdout = new PassThrough();
        const writtenChunks: Buffer[] = [];
        stdout.on('data', (chunk: Buffer) => {
          writtenChunks.push(chunk);
        });

        const { exitCode } = await runCli({
          ...nmr.deps,
          args,
          cwd: tree.dir,
          env: { [REPORT_FORMAT_ENV_VAR]: 'ndjson' },
          stderr: new PassThrough(),
          stdout,
        });

        expect(exitCode).toBe(2);
        expect(Buffer.concat(writtenChunks)).toHaveLength(0);
        expect(nmr.runSteps).not.toHaveBeenCalled();
      },
    );
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
      async ({ args, expectedStyle }, { nmr, tree }) => {
        await nmr.run(args, tree.dir);

        expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: expectedStyle });
      },
    );

    it('lets an inherited rich apply to a run that did not pass the flag', async ({ nmr, tree }) => {
      await nmr.run(['-F', 'my-pkg', 'build'], tree.dir, { [OUTPUT_STYLE_ENV_VAR]: 'rich' });

      expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: 'rich' });
    });

    it('lets the flag outrank an inherited rich', async ({ nmr, tree }) => {
      await nmr.run([OUTPUT_STYLE_FLAG, 'plain', '-F', 'my-pkg', 'build'], tree.dir, {
        [OUTPUT_STYLE_ENV_VAR]: 'rich',
      });

      expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: 'plain' });
    });

    // Never `auto`: a child on a pipe would otherwise detect plain rather than following the parent.
    it('exports a resolved style for an inherited auto', async ({ nmr, tree }) => {
      await nmr.run(['-F', 'my-pkg', 'build'], tree.dir, { [OUTPUT_STYLE_ENV_VAR]: 'auto' });

      expect(nmr.runSteps.mock.calls[0]?.[2].env).toMatchObject({ [OUTPUT_STYLE_ENV_VAR]: 'plain' });
    });

    it.for([
      { args: [OUTPUT_STYLE_FLAG], scenario: 'a flag at the end of the arguments' },
      { args: [`${OUTPUT_STYLE_FLAG}=`], scenario: 'an empty assignment' },
    ])('rejects $scenario', async ({ args }, { nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(args, tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain(OUTPUT_STYLE_FLAG);
    });

    it.for([
      { args: ['build'], scenario: 'a command' },
      { args: ['-F', 'my-pkg', 'build'], scenario: 'a filtered command' },
    ])(
      'given an unrecognized inherited value, rejects $scenario before doing anything',
      async ({ args }, { nmr, tree }) => {
        const stdout = new PassThrough();
        const writtenChunks: Buffer[] = [];
        stdout.on('data', (chunk: Buffer) => {
          writtenChunks.push(chunk);
        });

        const { exitCode } = await runCli({
          ...nmr.deps,
          args,
          cwd: tree.dir,
          env: { [OUTPUT_STYLE_ENV_VAR]: 'fancy' },
          stderr: new PassThrough(),
          stdout,
        });

        expect(exitCode).toBe(2);
        expect(Buffer.concat(writtenChunks)).toHaveLength(0);
        expect(nmr.runSteps).not.toHaveBeenCalled();
      },
    );

    // The router answers help and the version before it reads nmr's flags, so neither reads a presentation value.
    it.for([['--help'], ['--version']])(
      'answers %s without reading an unrecognized inherited value',
      async (args, { nmr, tree }) => {
        const { exitCode } = await runCli({
          ...nmr.deps,
          args,
          cwd: tree.dir,
          env: { [OUTPUT_STYLE_ENV_VAR]: 'fancy' },
          stderr: new PassThrough(),
          stdout: new PassThrough(),
        });

        expect(exitCode).toBe(0);
      },
    );

    it('names the flag and every accepted value when it rejects the flag', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr([OUTPUT_STYLE_FLAG, 'fancy', 'fix'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain(OUTPUT_STYLE_FLAG);
      expect(stderr).toContain('auto, plain, rich');
    });
  });

  describe('exit codes', () => {
    it('propagates what the sequence returned', async ({ nmr, tree }) => {
      nmr.runSteps.mockResolvedValue({ exitCode: 2 });

      await expect(nmr.run(['fix'], tree.dir)).resolves.toStrictEqual({ exitCode: 2 });
    });
  });

  describe('verdicts', () => {
    it('reports a pass, naming the scope at which the command ran', async ({ nmr, tree }) => {
      const { stdout } = await nmr.runReadingStdout(['typecheck'], tree.dir);

      expect(stdout).toMatch(
        new RegExp(String.raw`^PASS ${path.basename(tree.dir)}: typecheck: passed in [\d.]+s` + '\n$'),
      );
    });

    it('reports a pass in emoji when the invocation asked for rich', async ({ nmr, tree }) => {
      const { stdout } = await nmr.runReadingStdout([OUTPUT_STYLE_FLAG, 'rich', 'typecheck'], tree.dir);

      expect(stdout).toMatch(
        new RegExp(String.raw`^✅ ${path.basename(tree.dir)}: typecheck: passed in [\d.]+s` + '\n$'),
      );
    });

    it('reports a failure with the exit code, which separates an interrupt from a real failure', async ({
      nmr,
      tree,
    }) => {
      nmr.runSteps.mockResolvedValue({ exitCode: 130 });

      const { exitCode, stdout } = await nmr.runReadingStdout(['typecheck'], tree.dir);

      expect(exitCode).toBe(130);
      expect(stdout).toContain('FAIL');
      expect(stdout).toContain('typecheck: failed in');
      expect(stdout).toContain('(exit 130)');
    });

    it('reports in quiet mode, which withholds the command output and not the words that nmr writes itself', async ({
      nmr,
      tree,
    }) => {
      const { stdout } = await nmr.runReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('PASS');
    });

    it('reports the same pass as a JSON object, and does not write a prose line beside it', async ({ nmr, tree }) => {
      const { stdout } = await nmr.runReadingStdout(['--json', 'typecheck'], tree.dir);
      const parsedVerdict: unknown = JSON.parse(stdout);

      expect(stdout.endsWith('\n')).toBe(true);
      expect(parsedVerdict).toMatchObject({ command: 'typecheck', outcome: 'passed', scope: path.basename(tree.dir) });
    });

    it('reports a skip as a JSON object naming why it ran nothing', async ({ nmr, tree }) => {
      writePackageScripts(tree, { typecheck: '' });

      const { stdout } = await nmr.runReadingStdout(['--json', 'typecheck'], tree.dir);
      const parsedVerdict: unknown = JSON.parse(stdout);

      expect(parsedVerdict).toMatchObject({ command: 'typecheck', outcome: 'no-op', reason: 'empty-override' });
    });

    // The override notice is the one message that a quiet run withholds, and a machine-readable run is quiet.
    it('leaves stdout containing the object alone when a package script stands in for a built-in', async ({
      nmr,
      tree,
    }) => {
      writePackageScripts(tree, { typecheck: 'echo standing-in' });

      const { stdout } = await nmr.runReadingStdout(['--json', 'typecheck'], tree.dir);

      expect(stdout).not.toContain('Using override script');
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    });

    it.for([
      { args: ['typecheck:pre'], scenario: 'a hook leaf, whose chain the level above reports on' },
      { args: ['-R', 'typecheck'], scenario: 'the recursive delegate, whose scopes each report' },
      { args: ['-F', 'my-pkg', 'typecheck'], scenario: 'the filter delegate, whose scope reports' },
    ])('given $scenario, does not report a verdict', async ({ args }, { nmr, tree }) => {
      writeConfig(tree, { rootScripts: { 'typecheck:pre': 'echo hi' } });

      const { stdout } = await nmr.runReadingStdout(args, tree.dir);

      expect(stdout).toBe('');
    });

    it('reports nothing for a command that the registry does not define, having none to report on', async ({
      nmr,
      tree,
    }) => {
      const { exitCode, stdout } = await nmr.runReadingStdout(['nonexistent'], tree.dir, { NMR_RUN_IF_PRESENT: '1' });

      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
    });

    it.for([
      { expectedReason: 'the override is empty', script: '', scenario: 'an empty override' },
      { expectedReason: 'the override is a no-op', script: ':', scenario: 'a no-op override' },
    ])(
      'given $scenario, reports a skip distinguishable from a pass',
      async ({ expectedReason, script }, { nmr, tree }) => {
        writePackageScripts(tree, { typecheck: script });

        const { exitCode, stdout } = await nmr.runReadingStdout(['typecheck'], tree.dir);

        expect(exitCode).toBe(0);
        expect(stdout).toBe(`NOOP ${path.basename(tree.dir)}: typecheck: skipped, ${expectedReason}\n`);
      },
    );

    // A verdict is a report on a run, and `--log` makes none: the reader gets a refusal instead.
    it.for([
      { scenario: 'an empty override', script: '' },
      { scenario: 'a no-op override', script: ':' },
    ])('given $scenario, does not report a skip verdict under --log', async ({ script }, { nmr, tree }) => {
      writePackageScripts(tree, { typecheck: script });

      const { exitCode, stdout } = await nmr.runReadingStdout(['--log', 'typecheck'], tree.dir);
      const { stderr } = await nmr.runReadingStderr(['--log', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('no recording');
    });

    it('reports the skip in quiet mode, in which a silent exit 0 would read as a pass', async ({ nmr, tree }) => {
      writePackageScripts(tree, { typecheck: ':' });

      const { stdout } = await nmr.runReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('NOOP');
    });
  });
});
