import { realpathSync } from 'node:fs';
import path from 'node:path';

import type { TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { ENTRY_CHAIN_ENV_VAR } from '../entry-chain.ts';
import { readFilterSelection } from '../helpers/filter-selection.ts';
import { OUTPUT_STYLE_FLAG } from '../output-style.ts';
import { runCli } from '../runCli.ts';
import { runSteps } from '../runner.ts';
import { createWorkspaceTree } from '../test-utils/run-cli-fixtures.ts';
import {
  composeChainEnv,
  readChainFromCall,
  readStepsFromCall,
  runNmr,
  runNmrReadingStderr,
  writeConfig,
  writePackageScripts,
} from '../test-utils/run-cli-harness.ts';
import { UserError } from '../UserError.ts';

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
          'Delete the entry and move the steps that it adds to a `fix:pre` or `fix:post` script.',
        command: 'fix',
        scenario: 'a package.json entry adding steps to what nmr already runs',
        setup: (tree: TempTree) => writePackageScripts(tree, { fix: 'nmr lint && rdy compile' }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.probe` reaches nmr through a shell (`nmr fmt && tsx sync.ts`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script cannot contain a step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a package.json entry whose command the registry does not define',
        setup: (tree: TempTree) => writePackageScripts(tree, { probe: 'nmr fmt && tsx sync.ts' }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.probe` reaches nmr through a shell (`tsx sync.ts\\nnmr fmt`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script cannot contain a step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        command: 'probe',
        scenario: 'a package.json entry written across lines, which the warning quotes as it appears in the file',
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

    it.for([
      {
        expectedRemedy:
          'Replace the value with `node scripts/compile-ports.ts` and delete `compile:ports`, the script that it names.',
        scenario: 'a leaf script that only the package defines',
        scripts: { 'build:pre': 'nmr compile:ports', 'compile:ports': 'node scripts/compile-ports.ts' },
      },
      {
        expectedRemedy: "Replace the value with `eslint src`, and keep `lint`, which overrides nmr's own.",
        scenario: 'a leaf script that overrides a registry command',
        scripts: { 'build:pre': 'nmr lint', lint: 'eslint src' },
      },
    ])('given a hook naming $scenario, prescribes inlining it', async ({ expectedRemedy, scripts }, { tree }) => {
      writePackageScripts(tree, scripts);

      const { stderr } = await runNmrReadingStderr(['build:pre'], tree.dir);

      expect(stderr.trim()).toBe(
        `WARN package.json: \`scripts.build:pre\` reaches nmr through a shell (\`${scripts['build:pre']}\`), ` +
          `so nmr handles the nested run's output as a tool's. ${expectedRemedy}`,
      );
    });

    // Each shape falls outside the inline case, so the entry keeps the remedy that its registry status decides.
    it.for([
      { scenario: 'chains further steps', scripts: { 'build:pre': 'nmr ports && echo done', ports: 'tsx p.ts' } },
      { scenario: 'passes an argument', scripts: { 'build:pre': 'nmr ports --watch', ports: 'tsx p.ts' } },
      { scenario: 'names a script that resolves from the registry', scripts: { 'build:pre': 'nmr lint' } },
      { scenario: 'names a skip value', scripts: { 'build:pre': 'nmr ports', ports: ':' } },
      { scenario: 'names a script that itself crosses', scripts: { 'build:pre': 'nmr ports', ports: 'nmr fmt' } },
      {
        scenario: 'names a script that has a pre-hook',
        scripts: { 'build:pre': 'nmr ports', ports: 'tsx p.ts', 'ports:pre': 'echo pre' },
      },
      {
        scenario: 'names a script that has a post-hook',
        scripts: { 'build:pre': 'nmr ports', ports: 'tsx p.ts', 'ports:post': 'echo post' },
      },
    ])('given a hook that $scenario, keeps the step-list remedy', async ({ scripts }, { tree }) => {
      writePackageScripts(tree, scripts);

      const { stderr } = await runNmrReadingStderr(['build:pre'], tree.dir);

      expect(stderr).toContain('A `package.json` script cannot contain a step list: define `build:pre`');
      expect(stderr).not.toContain('Replace the value');
    });

    // nmr does not wrap a hook in hooks of its own, so a `probe:post:pre` would name a script that never runs.
    it.for([
      {
        expectedMessage:
          'WARN .config/nmr.config.ts: `rootScripts.probe:post` reaches nmr through a shell ' +
          "(`nmr fmt && echo done`), so nmr handles the nested run's output as a tool's. " +
          'Write the nmr steps as a step list, and move any others to a script of their own that the step ' +
          'list names, because a hook does not have a `:pre` or `:post` of its own.',
        scenario: 'a config entry',
        setup: (tree: TempTree) => writeConfig(tree, { rootScripts: { 'probe:post': 'nmr fmt && echo done' } }),
      },
      {
        expectedMessage:
          'WARN package.json: `scripts.probe:post` reaches nmr through a shell (`nmr fmt && echo done`), ' +
          "so nmr handles the nested run's output as a tool's. " +
          'A `package.json` script cannot contain a step list: define `probe:post` in `.config/nmr.config.ts` and ' +
          'move the package-specific steps to a script of their own that the step list names, because a hook ' +
          'does not have a `:pre` or `:post` of its own.',
        scenario: 'a package.json entry',
        setup: (tree: TempTree) => writePackageScripts(tree, { 'probe:post': 'nmr fmt && echo done' }),
      },
    ])(
      'given a hook declared by $scenario, does not name a hook below it',
      async ({ expectedMessage, setup }, { tree }) => {
        setup(tree);

        const { stderr } = await runNmrReadingStderr(['probe:post'], tree.dir);

        expect(stderr.trim()).toBe(expectedMessage);
      },
    );

    it('opens the warning in emoji when the invocation asked for rich', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { probe: 'nmr fmt' } });

      const { stderr } = await runNmrReadingStderr([OUTPUT_STYLE_FLAG, 'rich', 'probe'], tree.dir);

      expect(stderr.startsWith('🟠 ')).toBe(true);
    });

    it('prints it on one line', async ({ tree }) => {
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
    // The remedy is the one for a crossing, because the entry has to go either way; the consequence names what is
    // lost here.
    it.for([
      {
        expectedMessage:
          'package.json: `scripts.build` re-invokes `nmr build` (`nmr build && rdy compile`), ' +
          'so nmr cannot run the steps that it chains. ' +
          'Delete the entry and move the steps that it adds to a `build:pre` or `build:post` script.',
        scenario: 'placed ahead of the steps that it chains',
        scripts: { build: 'nmr build && rdy compile' },
      },
      {
        expectedMessage:
          'package.json: `scripts.build` re-invokes `nmr build` (`rdy compile && nmr build`), ' +
          'so nmr cannot run the steps that it chains. ' +
          'Delete the entry and move the steps that it adds to a `build:pre` or `build:post` script.',
        scenario: 'placed behind the steps that it chains, which honouring would re-enter without bound',
        scripts: { build: 'rdy compile && nmr build' },
      },
      {
        expectedMessage:
          'package.json: `scripts.probe` re-invokes `nmr probe` (`nmr probe && tsx sync.ts`), ' +
          'so nmr cannot run the steps that it chains. ' +
          'A `package.json` script cannot contain a step list: define `probe` in `.config/nmr.config.ts` and move the ' +
          'package-specific steps to a `probe:pre` or `probe:post` script.',
        scenario: 'naming a command that the registry does not define',
        scripts: { probe: 'nmr probe && tsx sync.ts' },
      },
      {
        expectedMessage:
          'package.json: `scripts.build` re-invokes `nmr build` (`nmr build\\nrdy compile`), ' +
          'so nmr cannot run the steps that it chains. ' +
          'Delete the entry and move the steps that it adds to a `build:pre` or `build:post` script.',
        scenario: 'written across lines, which the error quotes as it appears in the file',
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

    it('rejects a package entry that chains steps onto sending its own command to every package', async ({ tree }) => {
      tree.writeJson('packages/my-pkg/package.json', {
        name: 'my-pkg',
        scripts: { build: 'nmr -R build && rdy compile' },
      });

      await expect(runNmr(['build'], path.join(tree.dir, 'packages/my-pkg'))).rejects.toThrow(
        new UserError(
          'packages/my-pkg/package.json: `scripts.build` re-invokes `nmr build` (`nmr -R build && rdy compile`), ' +
            'so nmr cannot run the steps that it chains. ' +
            'Delete the entry and move the steps that it adds to a `build:pre` or `build:post` script.',
        ),
      );
    });

    it('runs nothing', async ({ tree }) => {
      writePackageScripts(tree, { build: 'nmr build && rdy compile' });

      await expect(runNmr(['build'], tree.dir)).rejects.toThrow(UserError);
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    // `--log` reads a recording rather than running one, so a step of the entry cannot go missing.
    it('is not rejected when the invocation only reads a recording', async ({ tree }) => {
      writePackageScripts(tree, { build: 'nmr build && rdy compile' });

      const { stderr } = await runNmrReadingStderr(['--log', 'build'], tree.dir);

      expect(stderr).not.toContain('re-invokes');
    });

    it.for([
      { scenario: 'standing alone', scripts: { build: 'nmr build' } },
      { scenario: 'with trailing arguments, which do not declare a step', scripts: { build: 'nmr build --verbose' } },
    ])('reports nothing for one $scenario, running the registry entry instead', async ({ scripts }, { tree }) => {
      writePackageScripts(tree, scripts);

      const { exitCode, stderr } = await runNmrReadingStderr(['build'], tree.dir);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(readStepsFromCall()).toStrictEqual([{ kind: 'structural', argv: ['nmr', '-R', 'build'] }]);
    });

    // nmr does not wrap a hook in hooks of its own, so naming `lint:post:pre` would name a script that never
    // runs.
    it('tells a rejected hook to keep its steps, since it does not have a script below it to move them to', async ({
      tree,
    }) => {
      writePackageScripts(tree, { 'lint:post': 'nmr lint:post && rdy compile' });

      await expect(runNmr(['lint:post'], tree.dir)).rejects.toThrow(
        new UserError(
          'package.json: `scripts.lint:post` re-invokes `nmr lint:post` (`nmr lint:post && rdy compile`), ' +
            'so nmr cannot run the steps that it chains. ' +
            'Delete the re-invocation: `lint:post` runs the steps beside it.',
        ),
      );
    });

    // Because the default registry does not define any hooks, a dropped hook is the common case rather than an
    // edge case.
    it('wraps a rejected hook that the registry does not define, so that its own process reports it', async ({
      tree,
    }) => {
      writePackageScripts(tree, { 'lint:post': 'nmr lint:post && rdy compile' });

      const { exitCode } = await runNmrReadingStderr(['lint'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'opaque', command: 'eslint --fix .' },
        { kind: 'structural', argv: ['nmr', 'lint:post'] },
      ]);
      expect(exitCode).toBe(0);
    });
  });

  describe('the entry chain', () => {
    it('rejects a command that an ancestor is already running in the same directory, running nothing', async ({
      tree,
    }) => {
      const env = composeChainEnv([{ command: 'build', dir: realpathSync(tree.dir) }]);

      await expect(runNmr(['build'], tree.dir, env)).rejects.toThrow('nmr re-entered `build` in root');
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    it('passes the inherited chain and its own entry to the steps that it runs', async ({ tree }) => {
      const inherited = [{ command: 'test', dir: realpathSync(tree.dir) }];

      await runNmr(['build'], tree.dir, composeChainEnv(inherited));

      expect(readChainFromCall()).toStrictEqual([...inherited, { command: 'build', dir: realpathSync(tree.dir) }]);
    });

    // The root's own `build` entry spawns `nmr -R build` in the root, which only hands the command to pnpm.
    it.for([
      { args: ['-R', 'build'], scenario: 'a fan-out' },
      { args: ['-F', 'my-pkg', 'build'], scenario: 'a filter' },
    ])('neither checks nor extends the chain for $scenario', async ({ args }, { tree }) => {
      const inherited = [{ command: 'build', dir: realpathSync(tree.dir) }];

      await runNmr(args, tree.dir, composeChainEnv(inherited));

      expect(readChainFromCall()).toStrictEqual(inherited);
    });

    it('does not reject an invocation that only reads a recording', async ({ tree }) => {
      const env = composeChainEnv([{ command: 'build', dir: realpathSync(tree.dir) }]);

      const { stderr } = await runNmrReadingStderr(['--log', 'build'], tree.dir, env);

      expect(stderr).not.toContain('re-entered');
    });

    it('rejects a malformed chain only where it would be read', async ({ tree }) => {
      const env = { [ENTRY_CHAIN_ENV_VAR]: 'not a chain' };

      await expect(runNmr(['build'], tree.dir, env)).rejects.toThrow(ENTRY_CHAIN_ENV_VAR);
      await expect(runNmr(['--help'], tree.dir, env)).resolves.toStrictEqual({ exitCode: 0 });
    });
  });
});
