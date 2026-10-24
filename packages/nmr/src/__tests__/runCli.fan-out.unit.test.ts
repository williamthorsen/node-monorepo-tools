import { existsSync } from 'node:fs';
import path from 'node:path';

import { captureWarnings, createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { readFilterSelection } from '../helpers/filter-selection.ts';
import { LOCK_DIR_ENV_VAR, LOCK_TOKEN_ENV_VAR, NO_LOCK_ENV_VAR } from '../machine-lock.ts';
import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import { renderChain } from '../steps.ts';
import { createWorkspaceTree } from '../test-utils/run-cli-fixtures.ts';
import {
  readStepsFromCall,
  runNmr,
  runNmrReadingStderr,
  runNmrReadingStdout,
  writePackageScripts,
} from '../test-utils/run-cli-harness.ts';

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

const it = baseIt
  .extend(
    'tree',
    makeFixture(() => createWorkspaceTree()),
  )
  .extend(
    'packagelessTree',
    makeFixture(() =>
      createTempTree({ 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n' }, { prefix: 'nmr-runcli-empty-' }),
    ),
  )
  .extend(
    'listlessTree',
    makeFixture(() =>
      createTempTree({ 'pnpm-workspace.yaml': 'shamefully-hoist: true\n' }, { prefix: 'nmr-runcli-listless-' }),
    ),
  )
  .extend(
    'unreadablePackagesTree',
    makeFixture(() =>
      createTempTree(
        { 'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - 42\n' },
        { prefix: 'nmr-runcli-unreadable-packages-' },
      ),
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
  )
  .extend(
    'unreadableTree',
    makeFixture(() =>
      createTempTree(
        { 'pnpm-workspace.yaml': 'packages:\n  - "unterminated\n  - packages/*\n' },
        { prefix: 'nmr-runcli-unreadable-' },
      ),
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
        scenario: 'a filter pattern that the shell reads literally',
      },
      {
        args: ['-F', './packages/*', 'build'],
        expectedArgv: ['pnpm', '--filter', './packages/*', 'exec', 'nmr', 'build'],
        scenario: 'a filter pattern that the shell would expand',
      },
      {
        args: ['-F', 'my-pkg', 'test', '--reporter=json'],
        expectedArgv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'test', '--reporter=json'],
        scenario: 'a passthrough argument that does not need quoting',
      },
      {
        args: ['-F', 'my-pkg', 'test', '-t', 'a b'],
        expectedArgv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'test', '-t', 'a b'],
        scenario: 'a passthrough argument containing a space',
      },
    ])('given $scenario, delegates through pnpm as argv tokens', async ({ args, expectedArgv }, { tree }) => {
      await runNmr(args, tree.dir);

      expect(readStepsFromCall()).toStrictEqual([{ kind: 'structural', argv: expectedArgv }]);
    });

    // A delegate spawns `pnpm`, not `nmr`, and still inherits: a step's kind follows from how nmr composed it.
    it('classifies the delegate as structural although the binary that it spawns is pnpm', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(readStepsFromCall()?.[0]?.kind).toBe('structural');
    });

    it('renders the delegate to the chain string that it had as one shell command', async ({ tree }) => {
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
    ])('passes `--log` to the delegate, ahead of the command name', async ({ args, expectedStep }, { tree }) => {
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

  describe('machine lock', () => {
    it('hands the lock token to the delegate of a heavy fan-out', async ({ tree }) => {
      await runNmr(['-R', 'test'], tree.dir, {
        [LOCK_DIR_ENV_VAR]: path.join(tree.dir, 'locks'),
        [NO_LOCK_ENV_VAR]: '',
      });

      expect(mockedRunSteps.mock.calls[0]?.[2].env?.[LOCK_TOKEN_ENV_VAR]).toMatch(/^[\da-f-]{36}$/);
    });

    it.for([
      { args: ['-R', 'build'], case: 'a light fan-out' },
      { args: ['-R', '--log', 'test'], case: 'a fan-out that reads recordings' },
    ])('does not take the lock for $case', async ({ args }, { tree }) => {
      await runNmr(args, tree.dir, { [LOCK_DIR_ENV_VAR]: path.join(tree.dir, 'locks'), [NO_LOCK_ENV_VAR]: '' });

      expect(mockedRunSteps.mock.calls[0]?.[2].env).not.toHaveProperty(LOCK_TOKEN_ENV_VAR);
    });

    it('releases the lock once the delegate ends', async ({ tree }) => {
      const lockDir = path.join(tree.dir, 'locks');

      await runNmr(['-R', 'test'], tree.dir, { [LOCK_DIR_ENV_VAR]: lockDir, [NO_LOCK_ENV_VAR]: '' });

      expect(existsSync(path.join(lockDir, 'heavy.lock'))).toBe(false);
    });
  });

  describe('empty selection', () => {
    // Composition reads an empty pattern as a missing filter, which would run the command unfiltered.
    it('rejects an empty pattern as it rejects a missing one', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-F', '', 'build'], tree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-F/--filter requires a pattern argument');
    });

    it('asks pnpm what the pattern selects, from the monorepo root in which the delegate runs', async ({ tree }) => {
      await runNmr(['-F', 'my-pkg', 'build'], tree.dir);

      expect(mockedReadFilterSelection).toHaveBeenCalledWith('my-pkg', tree.dir);
    });

    it('refuses a filter that selects nothing, naming the pattern and what it is matched against', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', 'secrets', 'test'], tree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-F/--filter did not match any workspace: `secrets`');
      expect(stderr).toContain("A pattern matches a package's manifest `name`, not its directory name.");
    });

    // Reading what a scope recorded is as silent as running it, so the refusal covers the flag too.
    it('refuses under `--log` as well', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', 'secrets', '--log', 'test'], tree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-F/--filter did not match any workspace: `secrets`');
    });

    // The reported mistake is a directory name standing in for a longer manifest name, which is too many edits
    // away for the nearest-name search to find.
    it('names a workspace whose name contains the rejected pattern', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { stderr } = await runNmrReadingStderr(['-F', 'pkg', 'build'], tree.dir);

      expect(stderr).toContain('Did you mean `my-pkg`?');
    });

    it('names the nearest workspace when the pattern is not contained in any workspace name', async ({ tree }) => {
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
        expect(stderr).toContain(`-F/--filter did not match any workspace: \`${pattern}\``);
        expect(stderr).toContain('selects the packages under a directory');
        expect(stderr).not.toContain('manifest `name`');
      },
    );

    // An exclusion that leaves nothing selected is not a misspelt name, and a corrected name would not repair it.
    it('states the exclusion rule for a pattern that only excludes', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', '!./packages/*', 'build'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('A pattern beginning with `!` excludes what it matches');
      expect(stderr).not.toContain('manifest `name`');
    });

    // An empty changed-since selection reports that nothing changed, and a corrected name does not repair that
    // either.
    it('states the changed-since rule for a pattern containing a git ref', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', '[origin/main]', 'build'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('selects the packages changed since a git ref, and none has changed');
      expect(stderr).not.toContain('manifest `name`');
    });

    it('lists the workspace names when the pattern is not near any of them', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { stderr } = await runNmrReadingStderr(['-F', 'zzzzzzzzzz', 'build'], tree.dir);

      expect(stderr).toContain('The workspace declares `my-pkg`.');
    });

    // nmr refuses only on an answered probe: an unresolved one leaves pnpm to report the selector that it
    // rejected.
    it('delegates when the probe could not resolve the selection', async ({ tree }) => {
      mockedReadFilterSelection.mockReturnValue('unresolved');

      const { exitCode } = await runNmrReadingStderr(['-F', '[bogus-ref]', 'build'], tree.dir);

      expect(exitCode).toBe(0);
      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--filter', '[bogus-ref]', 'exec', 'nmr', 'build'] },
      ]);
    });

    // `pnpm --recursive` leaves the root project out, so in a workspace without a package it selects nothing.
    // `packagelessTree` declares `packages/*` over an empty tree, which is the no-package condition.
    it('refuses a recursive delegation in a workspace whose patterns do not match any manifest', async ({
      packagelessTree,
    }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], packagelessTree.dir);

      expect(exitCode).toBe(1);
      expect(readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('-R/--recursive did not match any workspace:');
      expect(stderr).toContain('pnpm-workspace.yaml declares `packages/*`');
      expect(stderr).toContain('the matcher did not find any directory containing a `package.json`');
      expect(stderr).toContain('unlike pnpm, it recognizes neither `package.yaml` nor `package.json5`');
      expect(stderr).toContain('Add a `package.json`');
    });

    it('refuses a recursive delegation when the manifest does not declare a `packages` list', async ({
      listlessTree,
    }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], listlessTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('does not declare a `packages` list, so the workspace contains the root package alone');
      expect(stderr).toContain('Declare a positive pattern such as `packages/*`');
    });

    // The manifest declares `packages/*` beside the bad entry, so a remedy sending the reader to declare a
    // pattern would name what is already there; the shape of the list is the fault.
    it('names the required shape when the `packages` value is not a list of strings', async ({
      unreadablePackagesTree,
    }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], unreadablePackagesTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('declares a `packages` value that is not a list of strings');
      expect(stderr).toContain('Make it a list whose every entry is a quoted pattern');
      expect(stderr).not.toContain('Declare a positive pattern');
    });

    it('refuses a recursive delegation when the exclusions remove every match', async ({ excludedTree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], excludedTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('pnpm-workspace.yaml declares `packages/*`, `!packages/*`');
      expect(stderr).toContain('`!` entries exclude every directory matched by the positive patterns');
      expect(stderr).toContain('Drop or narrow the exclusion');
    });

    // Because the manifest declares `packages/*` below a syntax error, the remedy that the other patternless
    // conditions share would send the reader to declare what is already there.
    it('names the syntax error when the manifest is not valid YAML', async ({ unreadableTree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], unreadableTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('is not valid YAML');
      expect(stderr).toContain('Repair the syntax error');
      expect(stderr).not.toContain('Declare a positive pattern');
    });

    // The matcher receives an unquoted `!pkg` as an empty entry, which is the very case that this message's
    // remedy names, so the message must not quote it back to the reader as an empty pair of backticks.
    it('names an entry that YAML left empty rather than quoting nothing', async ({ taggedTree }) => {
      using captured = captureWarnings();

      const { exitCode, stderr } = await runNmrReadingStderr(['-R', 'build'], taggedTree.dir);

      // A run reads the manifest more than once, and each read warns.
      expect(new Set(captured.warnings.map((warning) => warning.code))).toStrictEqual(new Set(['TAG_RESOLVE_FAILED']));
      expect(exitCode).toBe(1);
      expect(stderr).toContain('pnpm-workspace.yaml declares 1 entry that YAML left empty');
      expect(stderr).toContain('quote any `!` entry');
      expect(stderr).not.toContain('``');
    });

    // The pattern-shape rules answer which pattern would have matched, and in a package-free workspace none
    // would have: the workspace is the cause to report.
    it('reports the workspace when a filter is refused in a workspace without any package', async ({
      packagelessTree,
    }) => {
      mockedReadFilterSelection.mockReturnValue('empty');

      const { exitCode, stderr } = await runNmrReadingStderr(['-F', 'my-pkg', 'build'], packagelessTree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('-F/--filter did not match any workspace: `my-pkg`.');
      expect(stderr).toContain('the matcher did not find any directory containing a `package.json`');
      expect(stderr).not.toContain('manifest `name`');
    });

    it('leaves a recursive delegation alone when the workspace declares a package', async ({ tree }) => {
      const { exitCode } = await runNmrReadingStderr(['-R', 'build'], tree.dir);

      expect(exitCode).toBe(0);
      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--recursive', 'exec', 'nmr', 'build'], shouldWithholdInput: true },
      ]);
    });

    // The probe is a filter's own question; a recursive delegation does not have a pattern to put to pnpm.
    it('asks pnpm nothing for a recursive delegation', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(mockedReadFilterSelection).not.toHaveBeenCalled();
    });
  });

  // A `-R` that nmr composed into its own script did not ask for any fan-out on the caller's behalf, so a
  // workspace without a package leaves it nothing to do rather than failing the run. A typed `-R` keeps
  // refusing, above.
  describe('a composed recursive step in a package-free workspace', () => {
    it('drops the recursive step and runs the steps beside it', async ({ packagelessTree }) => {
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

    it('reports a no-op naming the workspace when the drop leaves the chain empty', async ({ packagelessTree }) => {
      const { exitCode, stdout } = await runNmrReadingStdout(['build'], packagelessTree.dir);

      expect(exitCode).toBe(0);
      expect(mockedRunSteps).not.toHaveBeenCalled();
      expect(stdout).toContain('build: skipped, the workspace does not declare any package');
      expect(stdout).not.toContain('the override is empty');
    });

    it('names the workspace in the JSON verdict, which a consumer reads the reason from', async ({
      packagelessTree,
    }) => {
      const { stdout } = await runNmrReadingStdout(['--json', 'build'], packagelessTree.dir);
      const parsedVerdict: unknown = JSON.parse(stdout);

      expect(parsedVerdict).toMatchObject({ command: 'build', outcome: 'no-op', reason: 'empty-workspace' });
    });

    it('leaves a composite without a recursive step running every constituent', async ({ packagelessTree }) => {
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

    it('keeps a recursive step when the workspace contains a package', async ({ tree }) => {
      await runNmr(['test'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'root:test'] },
        { kind: 'structural', argv: ['nmr', '-R', 'test'] },
      ]);
    });
  });
});
