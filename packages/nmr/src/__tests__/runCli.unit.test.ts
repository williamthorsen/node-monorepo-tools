import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { type FilterSelection, readFilterSelection } from '../helpers/filter-selection.ts';
import { OUTPUT_STYLE_ENV_VAR, OUTPUT_STYLE_FLAG } from '../output-style.ts';
import { REPORT_FORMAT_ENV_VAR } from '../report-format.ts';
import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import { renderChain, type Step } from '../steps.ts';
import { UserError } from '../UserError.ts';
import { COMMAND_VERBOSITY_ENV_VAR } from '../verbosity.ts';

vi.mock(import('../runner.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  runSteps: vi.fn(),
}));

// The probe spawns pnpm, which a unit test neither has nor needs: what it answers is the input to the gate.
vi.mock(import('../helpers/filter-selection.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readFilterSelection: vi.fn(),
}));

const mockedRunSteps = vi.mocked(runSteps);
const mockedReadFilterSelection = vi.mocked(readFilterSelection);

const it = baseIt
  .extend(
    'tree',
    makeFixture(() =>
      createTempTree(
        { 'packages/my-pkg/package.json': '{"name":"my-pkg"}', 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' },
        { prefix: 'nmr-runcli-' },
      ),
    ),
  )
  .extend(
    'packagelessTree',
    makeFixture(() =>
      createTempTree({ 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' }, { prefix: 'nmr-runcli-empty-' }),
    ),
  )
  .extend(
    'patternlessTree',
    makeFixture(() =>
      createTempTree({ 'pnpm-workspace.yaml': 'shamefully-hoist: true\n' }, { prefix: 'nmr-runcli-patternless-' }),
    ),
  )
  .extend(
    'excludedTree',
    makeFixture(() =>
      createTempTree(
        {
          'packages/my-pkg/package.json': '{"name":"my-pkg"}',
          'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - '!packages/*'\n",
        },
        { prefix: 'nmr-runcli-excluded-' },
      ),
    ),
  )
  .extend(
    'taggedTree',
    makeFixture(() =>
      createTempTree({ 'pnpm-workspace.yaml': 'packages:\n  - !packages/legacy\n' }, { prefix: 'nmr-runcli-tagged-' }),
    ),
  );

describe(runCli, () => {
  beforeEach(() => {
    mockedRunSteps.mockReset();
    mockedRunSteps.mockResolvedValue({ exitCode: 0 });
    mockedReadFilterSelection.mockReset();
    mockedReadFilterSelection.mockReturnValue('single');
  });

  describe('delegation', () => {
    it.for([
      {
        args: ['-F', 'my-pkg', 'build'],
        expectedArgv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'build'],
        scenario: 'a filter pattern the shell reads literally',
      },
      {
        args: ['-F', './packages/*', 'build'],
        expectedArgv: ['pnpm', '--filter', './packages/*', 'exec', 'nmr', 'build'],
        scenario: 'a filter pattern the shell would expand',
      },
      {
        args: ['-F', 'my-pkg', 'test', '--reporter=json'],
        expectedArgv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'test', '--reporter=json'],
        scenario: 'a passthrough argument needing no quoting',
      },
      {
        args: ['-F', 'my-pkg', 'test', '-t', 'a b'],
        expectedArgv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'test', '-t', 'a b'],
        scenario: 'a passthrough argument holding a space',
      },
    ])('given $scenario, delegates through pnpm as argv tokens', async ({ args, expectedArgv }, { tree }) => {
      await runNmr(args, tree.dir);

      expect(readStepsFromCall()).toStrictEqual([{ kind: 'structural', argv: expectedArgv }]);
    });

    // A delegate spawns `pnpm`, not `nmr`, and still inherits: what classifies a step is how nmr composed it.
    it('classifies the delegate as structural although the binary it spawns is pnpm', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(readStepsFromCall()?.[0]?.kind).toBe('structural');
    });

    it('renders the delegate to the chain string it had as one shell command', async ({ tree }) => {
      await runNmr(['-F', './packages/*', 'test', '-t', 'a b'], tree.dir);

      expect(renderChain(readStepsFromCall() ?? [])).toBe("pnpm --filter './packages/*' exec nmr test -t 'a b'");
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
        expectedStep: { kind: 'structural', argv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', '--log', 'test'] },
      },
      {
        args: ['-R', '--log', 'test'],
        expectedStep: {
          kind: 'structural',
          argv: ['pnpm', '--recursive', 'exec', 'nmr', '--log', 'test'],
          shouldWithholdInput: true,
        },
      },
    ])('carries `--log` into the delegate, ahead of the command name', async ({ args, expectedStep }, { tree }) => {
      await runNmr(args, tree.dir);

      expect(readStepsFromCall()).toStrictEqual([expectedStep]);
    });

    // A fan-out asks every selected scope, so a scope that never ran the command is a gap in a survey rather
    // than a failure of one.
    it('tells a `--log` filter delegate to pass over a scope with nothing to show', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', '--log', 'test'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ NMR_RUN_IF_PRESENT: '1' });
    });
  });

  describe('input', () => {
    it('gives the packages of a recursive delegate no stdin', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--recursive', 'exec', 'nmr', 'build'], shouldWithholdInput: true },
      ]);
    });

    it('gives no stdin to the packages of a filter selecting several', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('multiple');

      await runNmr(['-F', './packages/*', 'build'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        {
          kind: 'structural',
          argv: ['pnpm', '--filter', './packages/*', 'exec', 'nmr', 'build'],
          shouldWithholdInput: true,
        },
      ]);
    });

    it.for<{ selection: FilterSelection }>([{ selection: 'single' }, { selection: 'unresolved' }])(
      'given a filter whose selection reads $selection, keeps nmr stdin',
      async ({ selection }, { tree }) => {
        mockedReadFilterSelection.mockReturnValue(selection);

        await runNmr(['-F', 'my-pkg', 'build'], tree.dir);

        expect(readStepsFromCall()).toStrictEqual([
          { kind: 'structural', argv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'build'] },
        ]);
      },
    );

    it('asks pnpm once for both the refusal and the input', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('multiple');

      await runNmr(['-F', './packages/*', 'build'], tree.dir);

      expect(mockedReadFilterSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty selection', () => {
    // An empty pattern reads as no filter at all in composition, which would run the command unfiltered.
    it('rejects an empty pattern as it rejects a missing one', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-F', '', 'build'], tree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-F/--filter requires a pattern argument');
    });

    it('asks pnpm what the pattern selects, from the monorepo root the delegate runs in', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir);

      expect(mockedReadFilterSelection).toHaveBeenCalledWith('my-pkg', tree.dir);
    });

    it('refuses a filter that selects nothing, naming the pattern and what it is matched against', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', 'secrets', 'test'], tree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-F/--filter matched no workspace: `secrets`');
      expect(stderr).toContain("A pattern matches a package's manifest `name`, not its directory name.");
    });

    // Reading what a scope recorded is as silent as running it, so the refusal covers the flag too.
    it('refuses under `--log` as well', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', 'secrets', '--log', 'test'], tree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-F/--filter matched no workspace: `secrets`');
    });

    // A directory name standing in for a longer manifest name is the reported mistake, and it sits too many
    // edits away for the nearest-name search to reach.
    it('names a workspace whose name contains the rejected pattern', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { stderr } = await runNmrReadingStderr(['-F', 'pkg', 'build'], tree.dir);

      expect(stderr).toContain('Did you mean `my-pkg`?');
    });

    it('names the nearest workspace where no name contains the pattern', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { stderr } = await runNmrReadingStderr(['-F', 'my-pkq', 'build'], tree.dir);

      expect(stderr).toContain('Did you mean `my-pkg`?');
    });

    // A directory pattern selects by directory, so the name rule would name the wrong thing to go looking at.
    it.for([{ pattern: './packages/nope' }, { pattern: '{packages/nope}' }])(
      'states the directory rule for $pattern, which pnpm reads as a directory',
      async ({ pattern }, { tree }) => {
        mockedReadFilterSelection.mockReturnValue('empty');

        const { exitCode, stderr } = await runNmrReadingStderr(['-F', pattern, 'build'], tree.dir);

        expect(exitCode).toBe(1);
        expect(stderr).toContain(`-F/--filter matched no workspace: \`${pattern}\``);
        expect(stderr).toContain('selects the packages under a directory');
        expect(stderr).not.toContain('manifest `name`');
      },
    );

    // An exclusion that leaves nothing standing is not a misspelt name, and no name would repair it.
    it('states the exclusion rule for a pattern that only excludes', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', '!./packages/*', 'build'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('A pattern beginning with `!` excludes what it matches');
      expect(stderr).not.toContain('manifest `name`');
    });

    // Nothing changed is what an empty changed-since selection reports, and no name repairs that either.
    it('states the changed-since rule for a pattern carrying a git ref', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', '[origin/main]', 'build'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('selects the packages changed since a git ref, and none has changed');
      expect(stderr).not.toContain('manifest `name`');
    });

    it('lists the workspace names where the pattern is near none of them', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { stderr } = await runNmrReadingStderr(['-F', 'zzzzzzzzzz', 'build'], tree.dir);

      expect(stderr).toContain('The workspace declares `my-pkg`.');
    });

    // Only an answered probe refuses: an unread one leaves pnpm to report the selector it rejected.
    it('delegates where the probe could not resolve the selection', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('unresolved');

      const { exitCode } = await runNmrReadingStderr(['-F', '[bogus-ref]', 'build'], tree.dir);

      expect(exitCode).toBe(0);
      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--filter', '[bogus-ref]', 'exec', 'nmr', 'build'] },
      ]);
    });

    // `pnpm --recursive` leaves the root project out, so a workspace with no package fans out to nothing.
    // `packagelessTree` declares `packages/*` over an empty tree, which is the no-manifest condition.
    it('refuses a recursive delegation in a workspace whose patterns match no manifest', async ({
      packagelessTree,
    }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], packagelessTree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-R/--recursive matched no workspace:');
      expect(stderr).toContain('pnpm-workspace.yaml declares `packages/*`');
      expect(stderr).toContain('the matcher found no directory holding a `package.json`');
      expect(stderr).toContain('unlike pnpm, it recognizes neither `package.yaml` nor `package.json5`');
      expect(stderr).toContain('Add a `package.json`');
    });

    it('refuses a recursive delegation where the manifest declares no positive pattern', async ({
      patternlessTree,
    }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], patternlessTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('pnpm-workspace.yaml declares no `packages` list, so no pattern reaches the matcher');
      expect(stderr).toContain('Declare a positive pattern such as `packages/*`');
    });

    it('refuses a recursive delegation where the exclusions remove every match', async ({ excludedTree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], excludedTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('pnpm-workspace.yaml declares `packages/*`, `!packages/*`');
      expect(stderr).toContain('`!` entries exclude every directory matched by the positive patterns');
      expect(stderr).toContain('Drop or narrow the exclusion');
    });

    // An unquoted `!pkg` reaches the matcher as an empty entry, which is the very case this message's remedy
    // names, so quoting it back as an empty pair of backticks is what the reader must not be given.
    it('names an entry YAML left empty rather than quoting nothing', async ({ taggedTree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], taggedTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('pnpm-workspace.yaml declares 1 entry that YAML left empty');
      expect(stderr).toContain('quote any `!` entry');
      expect(stderr).not.toContain('``');
    });

    // The pattern-shape rules answer which pattern would have matched, and in a package-free workspace none
    // would have, so the workspace is the cause to report.
    it('reports the workspace where a filter is refused in a workspace holding no package', async ({
      packagelessTree,
    }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', 'my-pkg', 'build'], packagelessTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('-F/--filter matched no workspace: `my-pkg`.');
      expect(stderr).toContain('the matcher found no directory holding a `package.json`');
      expect(stderr).not.toContain('manifest `name`');
    });

    it('leaves a recursive delegation alone where the workspace declares a package', async ({ tree }) => {
      const { exitCode } = await runNmrReadingStderr(['-R', 'build'], tree.dir);

      expect(exitCode).toBe(0);
      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--recursive', 'exec', 'nmr', 'build'], shouldWithholdInput: true },
      ]);
    });

    // The probe is a filter's own question; a recursive delegation has no pattern to put to pnpm.
    it('asks pnpm nothing for a recursive delegation', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(mockedReadFilterSelection).not.toHaveBeenCalled();
    });
  });

  // A `-R` nmr composed into its own script asked for no fan-out on the caller's behalf, so a workspace with
  // no package leaves it nothing to do rather than failing the run. A typed `-R` keeps refusing, above.
  describe('a composed recursive step in a package-free workspace', () => {
    it('drops the recursive step and runs what stands beside it', async ({ packagelessTree }) => {
      await runNmr(['test'], packagelessTree.dir);

      expect(readStepsFromCall()).toStrictEqual([{ kind: 'structural', argv: ['nmr', 'root:test'] }]);
    });

    it('drops the recursive step from a composite whose other step declines the arguments', async ({
      packagelessTree,
    }) => {
      await runNmr(['typecheck'], packagelessTree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'root:typecheck'], shouldDeclineArguments: true },
      ]);
    });

    it('reports a no-op naming the workspace where the drop leaves no step at all', async ({ packagelessTree }) => {
      const { exitCode, stdout } = await runNmrReadingStdout(['build'], packagelessTree.dir);

      expect(exitCode).toBe(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
      expect(stdout).toContain('build: skipped, the workspace declares no package');
      expect(stdout).not.toContain('the override is empty');
    });

    it('names the workspace in the JSON verdict, which a consumer reads the reason from', async ({
      packagelessTree,
    }) => {
      const { stdout } = await runNmrReadingStdout(['--json', 'build'], packagelessTree.dir);
      const parsedVerdict: unknown = JSON.parse(stdout);

      expect(parsedVerdict).toMatchObject({ command: 'build', outcome: 'no-op', reason: 'empty-workspace' });
    });

    it('leaves a composite carrying no recursive step reaching every constituent', async ({ packagelessTree }) => {
      await runNmr(['ci'], packagelessTree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'build'], shouldDeclineArguments: true },
        { kind: 'structural', argv: ['nmr', 'check:strict'] },
      ]);
    });

    it('still reports an empty override as an empty override, which the drop did not empty', async ({
      packagelessTree,
    }) => {
      writePackageScripts(packagelessTree, { build: '' });

      const { stdout } = await runNmrReadingStdout(['--json', 'build'], packagelessTree.dir);
      const parsedVerdict: unknown = JSON.parse(stdout);

      expect(parsedVerdict).toMatchObject({ outcome: 'no-op', reason: 'empty-override' });
    });

    it('leaves a recursive step standing where the workspace holds a package', async ({ tree }) => {
      await runNmr(['test'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'root:test'] },
        { kind: 'structural', argv: ['nmr', '-R', 'test'] },
      ]);
    });
  });

  describe('step composition', () => {
    it('resolves a composite to one structural step per element', async ({ tree }) => {
      await runNmr(['fix'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });

    it('resolves a string script to one opaque step', async ({ tree }) => {
      await runNmr(['lint'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([{ kind: 'opaque', command: 'eslint --fix .' }]);
    });

    it('propagates `-w` to each element, so a child selects the root registry on its own', async ({ tree }) => {
      await runNmr(['-w', 'fix'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', '-w', 'lint'] },
        { kind: 'structural', argv: ['nmr', '-w', 'fmt'] },
      ]);
    });

    it('wraps a command in the hooks that resolve, as structural steps of their own', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { 'lint:post': 'echo done', 'lint:pre': 'echo starting' } });

      await runNmr(['lint'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint:pre'] },
        { kind: 'opaque', command: 'eslint --fix .' },
        { kind: 'structural', argv: ['nmr', 'lint:post'] },
      ]);
    });
  });

  describe('passthrough arguments', () => {
    it('binds to every element of a composite and never to a hook', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { 'fix:post': 'echo done', 'fix:pre': 'echo starting' } });

      await runNmr(['fix', '--dry-run'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'fix:pre'] },
        { kind: 'structural', argv: ['nmr', 'lint', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fmt', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fix:post'] },
      ]);
    });

    it('leaves a declining element unnarrowed', async ({ tree }) => {
      writeConfig(tree, {
        rootScripts: { verify: [{ run: 'build', shouldDeclineArguments: true }, 'lint'] },
      });

      await runNmr(['verify', 'src/'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'build'], shouldDeclineArguments: true },
        { kind: 'structural', argv: ['nmr', 'lint', 'src/'] },
      ]);
    });

    it('runs nothing when no element accepts them, naming the command', async ({ tree }) => {
      writeConfig(tree, {
        rootScripts: {
          verify: [
            { run: 'build', shouldDeclineArguments: true },
            { run: 'lint', shouldDeclineArguments: true },
          ],
        },
      });

      const { exitCode, stderr } = await runNmrReadingStderr(['verify', 'src/'], tree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('`verify` takes no trailing arguments');
    });

    // The rejection precedes the recording branch, so reading what a command did and running it answer an
    // unroutable argument alike rather than one reporting nothing recorded.
    it('rejects an unroutable argument under --log too', async ({ tree }) => {
      writeConfig(tree, {
        rootScripts: {
          verify: [
            { run: 'build', shouldDeclineArguments: true },
            { run: 'lint', shouldDeclineArguments: true },
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
      writeConfig(tree, { rootScripts: { verify: [] } });

      const { exitCode, stdout } = await runNmrReadingStdout(['verify', 'src/'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('verify: skipped, the override is empty');
    });

    it('binds to a string script as shell-quoted text', async ({ tree }) => {
      await runNmr(['lint', '--max-warnings', '0'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([{ kind: 'opaque', command: "eslint --fix . '--max-warnings' '0'" }]);
    });

    it('quotes a structural argument once, where the chain string quotes only what the shell would act on', async ({
      tree,
    }) => {
      await runNmr(['fix', '-t', 'a b'], tree.dir);

      expect(readStepsFromCall()?.at(-1)).toStrictEqual({ kind: 'structural', argv: ['nmr', 'fmt', '-t', 'a b'] });
      expect(renderChain(readStepsFromCall() ?? [])).toBe("nmr lint -t 'a b' && nmr fmt -t 'a b'");
    });
  });

  describe('devBin substitution', () => {
    it('substitutes a leaf tool, which is the case docs/scripts.md documents', async ({ tree }) => {
      writeConfig(tree, { devBin: { eslint: 'node ./scripts/eslint.js' } });

      await runNmr(['lint'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'opaque', command: `node ${path.join(tree.dir, 'scripts/eslint.js')} --fix .` },
      ]);
    });

    // A composite's first position is nmr's own, not a leaf tool's: substituting it replaced one link of a
    // chain and left the rest running the published binary.
    it('leaves a composite alone, where the first token is the nmr that carries it', async ({ tree }) => {
      writeConfig(tree, { devBin: { nmr: 'node ./cli.js' } });

      await runNmr(['fix'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });
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

    it('lets an inherited quiet reach a run that passed no flag', async ({ tree }) => {
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

    it('takes the verbosity the repo configured', async ({ tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], tree.dir);

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('lets an inherited full outrank a quiet the repo configured', async ({ tree }) => {
      writeConfig(tree, { output: { commandVerbosity: 'quiet' } });

      await runNmr(['fix'], tree.dir, { [COMMAND_VERBOSITY_ENV_VAR]: 'full' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(false);
    });

    it('goes quiet under a harness on the shipped list', async ({ tree }) => {
      await runNmr(['fix'], tree.dir, { CLAUDECODE: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    it('goes quiet under a harness the repo added', async ({ tree }) => {
      writeConfig(tree, { output: { extraAgentEnvVars: ['MY_CLI'] } });

      await runNmr(['fix'], tree.dir, { MY_CLI: '1' });

      expect(mockedRunSteps.mock.calls[0]?.[2].quiet).toBe(true);
    });

    // Declining detection is what a configured `full` says, so no switch of its own exists to turn it off.
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
      { args: ['-F', 'my-pkg', 'build'], expectedFormat: 'text', scenario: 'a run passing no flag' },
      { args: ['--json', '-F', 'my-pkg', 'build'], expectedFormat: 'json', scenario: 'a run passing the flag' },
    ])(
      'given $scenario, hands the resolved format to every process below it',
      async ({ args, expectedFormat }, { tree }) => {
        await runNmr(args, tree.dir);

        expect(mockedRunSteps.mock.calls[0]?.[2].env).toMatchObject({ [REPORT_FORMAT_ENV_VAR]: expectedFormat });
      },
    );

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
        scenario: 'a run passing no flag, whose streams are pipes',
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

    it('lets an inherited rich reach a run that passed no flag', async ({ tree }) => {
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
      { args: [OUTPUT_STYLE_FLAG], scenario: 'a flag standing at the end of the arguments' },
      { args: [`${OUTPUT_STYLE_FLAG}=`], scenario: 'an assignment carrying nothing' },
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

  describe('the shelled-nmr boundary', () => {
    // The remedy follows from where the step was declared, so each origin gets the edit that resolves it.
    it.for([
      {
        expectedMessage:
          'WARN .config/nmr.config.ts: `rootScripts.probe` reaches nmr through a shell ' +
          "(`nmr fmt && echo done`), so nmr handles the nested run's output as a tool's. " +
          'Write the nmr steps as a step list, and move any others to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a config entry',
        setup: (tree: TempTree) => writeConfig(tree, { rootScripts: { probe: 'nmr fmt && echo done' } }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.fix` reaches nmr through a shell (`nmr lint && nmr fmt`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          "Delete the entry: nmr's own `fix` already runs `nmr lint && nmr fmt`.",
        command: 'fix',
        scenario: 'a package.json entry restating what nmr already runs',
        setup: (tree: TempTree) => writePackageScripts(tree, { fix: 'nmr lint && nmr fmt' }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.fix` reaches nmr through a shell (`nmr lint && rdy compile`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'Delete the entry and move the steps it adds to a `fix:pre` or `fix:post` script.',
        command: 'fix',
        scenario: 'a package.json entry adding steps to what nmr already runs',
        setup: (tree: TempTree) => writePackageScripts(tree, { fix: 'nmr lint && rdy compile' }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.probe` reaches nmr through a shell (`nmr fmt && tsx sync.ts`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script holds no step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a package.json entry whose command the registry does not define',
        setup: (tree: TempTree) => writePackageScripts(tree, { probe: 'nmr fmt && tsx sync.ts' }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.probe` reaches nmr through a shell (`tsx sync.ts\\nnmr fmt`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script holds no step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a package.json entry written across lines, whose entry quotes as the file holds it',
        setup: (tree: TempTree) => writePackageScripts(tree, { probe: 'tsx sync.ts\nnmr fmt' }),
      },
    ])(
      'given $scenario, names the site and the edit that resolves it',
      async ({ command, expectedMessage, setup }, { tree }) => {
        setup(tree);

        const { stderr } = await runNmrReadingStderr([command], tree.dir);

        expect(stderr.trim()).toBe(expectedMessage);
      },
    );

    // nmr wraps a hook in no hooks of its own, so a `probe:post:pre` would name a script that never runs.
    it.for([
      {
        expectedMessage:
          'WARN .config/nmr.config.ts: `rootScripts.probe:post` reaches nmr through a shell ' +
          "(`nmr fmt && echo done`), so nmr handles the nested run's output as a tool's. " +
          'Write the nmr steps as a step list, and move any others to a script of their own that the step ' +
          'list names, because a hook has no `:pre` or `:post` of its own.',
        scenario: 'a config entry',
        setup: (tree: TempTree) => writeConfig(tree, { rootScripts: { 'probe:post': 'nmr fmt && echo done' } }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.probe:post` reaches nmr through a shell (`nmr fmt && echo done`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script holds no step list: define `probe:post` in `.config/nmr.config.ts` and ' +
          'move the package-specific steps to a script of their own that the step list names, because a hook ' +
          'has no `:pre` or `:post` of its own.',
        scenario: 'a package.json entry',
        setup: (tree: TempTree) => writePackageScripts(tree, { 'probe:post': 'nmr fmt && echo done' }),
      },
    ])('given a hook declared by $scenario, names no hook below it', async ({ expectedMessage, setup }, { tree }) => {
      setup(tree);

      const { stderr } = await runNmrReadingStderr(['probe:post'], tree.dir);

      expect(stderr.trim()).toBe(expectedMessage);
    });

    it('opens the warning in emoji where the invocation asked for rich', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr([OUTPUT_STYLE_FLAG, 'rich', 'probe'], tree.dir);

      expect(stderr.startsWith('🟠 ')).toBe(true);
    });

    it('spends one line on it', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr(['probe'], tree.dir);

      expect(stderr.split('\n').filter((line) => line.length > 0)).toHaveLength(1);
    });

    it.for([
      { args: ['-q', 'probe'], scenario: 'the -q flag' },
      { args: ['probe'], env: { NMR_COMMAND_VERBOSITY: 'quiet' }, scenario: 'an inherited verbosity' },
    ])('reports it although $scenario made the run quiet', async ({ args, env }, { tree }) => {
      writeConfig(tree, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr(args, tree.dir, env);

      expect(stderr).toContain('reaches nmr through a shell');
    });

    it('leaves the exit code alone', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { probe: 'nmr fmt' } });

      const { exitCode } = await runNmrReadingStderr(['probe'], tree.dir);

      expect(exitCode).toBe(0);
    });

    it('reports a step reaching nmr through a launcher', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { probe: 'pnpm --recursive exec nmr build' } });

      const { stderr } = await runNmrReadingStderr(['probe'], tree.dir);

      expect(stderr).toContain('reaches nmr through a shell');
    });

    it.for([
      { args: ['fix'], scenario: 'a step list' },
      { args: ['-R', 'build'], scenario: 'the recursive delegate' },
      { args: ['-F', 'my-pkg', 'build'], scenario: 'the filter delegate' },
    ])('given $scenario, reports nothing', async ({ args }, { tree }) => {
      writeConfig(tree, { rootScripts: { build: 'pnpm --recursive exec nmr build' } });

      const { stderr } = await runNmrReadingStderr(args, tree.dir);

      expect(stderr).toBe('');
    });
  });

  describe('a self-referential package.json entry', () => {
    // The remedy is a crossing's, the entry having to go either way; the consequence names what is lost here.
    it.for([
      {
        expectedMessage:
          'package.json: `scripts.build` re-invokes `nmr build` (`nmr build && rdy compile`), ' +
          'so nmr cannot run the steps it chains. ' +
          'Delete the entry and move the steps it adds to a `build:pre` or `build:post` script.',
        scenario: 'standing ahead of the steps it chains',
        scripts: { build: 'nmr build && rdy compile' },
      },
      {
        expectedMessage:
          'package.json: `scripts.build` re-invokes `nmr build` (`rdy compile && nmr build`), ' +
          'so nmr cannot run the steps it chains. ' +
          'Delete the entry and move the steps it adds to a `build:pre` or `build:post` script.',
        scenario: 'standing behind the steps it chains, which honouring would re-enter without bound',
        scripts: { build: 'rdy compile && nmr build' },
      },
      {
        expectedMessage:
          'package.json: `scripts.probe` re-invokes `nmr probe` (`nmr probe && tsx sync.ts`), ' +
          'so nmr cannot run the steps it chains. ' +
          'A `package.json` script holds no step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        scenario: 'naming a command the registry does not define',
        scripts: { probe: 'nmr probe && tsx sync.ts' },
      },
      {
        expectedMessage:
          'package.json: `scripts.build` re-invokes `nmr build` (`nmr build\\nrdy compile`), ' +
          'so nmr cannot run the steps it chains. ' +
          'Delete the entry and move the steps it adds to a `build:pre` or `build:post` script.',
        scenario: 'written across lines, whose entry quotes as the file holds it',
        scripts: { build: 'nmr build\nrdy compile' },
      },
    ])(
      'given one $scenario, names the site and the edit that resolves it',
      async ({ expectedMessage, scripts }, { tree }) => {
        writePackageScripts(tree, scripts);
        const command = Object.keys(scripts)[0] ?? '';

        await expect(runNmr([command], tree.dir)).rejects.toThrow(new UserError(expectedMessage));
      },
    );

    it('runs nothing', async ({ tree }) => {
      writePackageScripts(tree, { build: 'nmr build && rdy compile' });

      await expect(runNmr(['build'], tree.dir)).rejects.toThrow(UserError);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    // `--log` reads a recording rather than running one, so no step of the entry could go missing.
    it('is not rejected when the invocation only reads a recording', async ({ tree }) => {
      writePackageScripts(tree, { build: 'nmr build && rdy compile' });

      const { stderr } = await runNmrReadingStderr(['--log', 'build'], tree.dir);

      expect(stderr).not.toContain('re-invokes');
    });

    it.for([
      { scenario: 'standing alone', scripts: { build: 'nmr build' } },
      { scenario: 'carrying trailing arguments, which declare no step', scripts: { build: 'nmr build --verbose' } },
    ])('reports nothing for one $scenario, running the registry entry instead', async ({ scripts }, { tree }) => {
      writePackageScripts(tree, scripts);

      const { exitCode, stderr } = await runNmrReadingStderr(['build'], tree.dir);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(readStepsFromCall()).toStrictEqual([{ kind: 'structural', argv: ['nmr', '-R', 'build'] }]);
    });

    // nmr wraps a hook in no hooks of its own, so naming `lint:post:pre` would name a script that never runs.
    it('tells a rejected hook to keep its steps, having no script below it to move them to', async ({ tree }) => {
      writePackageScripts(tree, { 'lint:post': 'nmr lint:post && rdy compile' });

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
      writePackageScripts(tree, { 'lint:post': 'nmr lint:post && rdy compile' });

      const { exitCode } = await runNmrReadingStderr(['lint'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
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
        new RegExp(String.raw`^PASS ${path.basename(tree.dir)}: typecheck: passed in [\d.]+s` + '\n$'),
      );
    });

    it('reports a pass in emoji where the invocation asked for rich', async ({ tree }) => {
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

    it('reports in quiet mode, which withholds the command output and not the words nmr writes itself', async ({
      tree,
    }) => {
      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('PASS');
    });

    it('reports the same pass as a JSON object, and writes no prose line beside it', async ({ tree }) => {
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

    // The override notice is the one message a quiet run withholds, and a machine-readable run is quiet.
    it('leaves stdout carrying the object alone where a package script stands in for a built-in', async ({ tree }) => {
      writePackageScripts(tree, { typecheck: 'echo standing-in' });

      const { stdout } = await runNmrReadingStdout(['--json', 'typecheck'], tree.dir);

      expect(stdout).not.toContain('Using override script');
      expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    });

    it.for([
      { args: ['typecheck:pre'], scenario: 'a hook leaf, whose chain the level above reports on' },
      { args: ['-R', 'typecheck'], scenario: 'the recursive delegate, whose scopes each report' },
      { args: ['-F', 'my-pkg', 'typecheck'], scenario: 'the filter delegate, whose scope reports' },
    ])('given $scenario, reports no verdict', async ({ args }, { tree }) => {
      writeConfig(tree, { rootScripts: { 'typecheck:pre': 'echo hi' } });

      const { stdout } = await runNmrReadingStdout(args, tree.dir);

      expect(stdout).toBe('');
    });

    it('reports nothing for a command the registry does not define, having none to report on', async ({ tree }) => {
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
    ])('given $scenario, reports no skip verdict under --log', async ({ script }, { tree }) => {
      writePackageScripts(tree, { typecheck: script });

      const { exitCode, stdout } = await runNmrReadingStdout(['--log', 'typecheck'], tree.dir);
      const { stderr } = await runNmrReadingStderr(['--log', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stdout).toBe('');
      expect(stderr).toContain('no recording');
    });

    it('reports the skip in quiet mode, where a silent exit 0 would read as a pass', async ({ tree }) => {
      writePackageScripts(tree, { typecheck: ':' });

      const { stdout } = await runNmrReadingStdout(['-q', 'typecheck'], tree.dir);

      expect(stdout).toContain('NOOP');
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
function readStepsFromCall(): readonly Step[] | undefined {
  return mockedRunSteps.mock.calls[0]?.[0];
}

/** Writes the tier-3 scripts of the monorepo root's own `package.json`. */
function writePackageScripts(tree: TempTree, scripts: Record<string, string>): void {
  tree.writeJson('package.json', { scripts });
}

/** Writes a monorepo-root config, which is the only tier that carries `devBin` and the script registries. */
function writeConfig(tree: TempTree, config: Record<string, unknown>): void {
  tree.write('.config/nmr.config.ts', `export default ${JSON.stringify(config)};\n`);
}

// endregion | Helpers
