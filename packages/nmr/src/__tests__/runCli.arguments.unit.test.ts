import path from 'node:path';

import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it as baseIt, vi } from 'vitest';

import { type FilterSelection, readFilterSelection } from '../helpers/filter-selection.ts';
import { DELEGATE_ENV_VAR } from '../remote-run.ts';
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

  describe('input', () => {
    it('withholds stdin from the packages of a recursive delegate', async ({ tree }) => {
      await runNmr(['-R', 'build'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--recursive', 'exec', 'nmr', 'build'], shouldWithholdInput: true },
      ]);
    });

    it('withholds stdin from the packages of a filter selecting several', async ({ tree }) => {
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

    it('propagates `-w` to each element, so that a child selects the root registry on its own', async ({ tree }) => {
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

    it('runs nothing when every element declines them, naming the command', async ({ tree }) => {
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
      expect(stderr).toContain('`verify` does not take trailing arguments');
    });

    // The rejection precedes the recording branch, so `--log` rejects an unroutable argument as a run does,
    // rather than reporting that nothing was recorded.
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
      expect(stderr).toContain('`verify` does not take trailing arguments');
    });

    // An empty override resolves to an empty step list, which does not have a step to accept the arguments.
    // The no-op check precedes the rejection so that the override keeps reporting as a no-op.
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

    it('quotes a structural argument once, while the chain string quotes only what the shell would act on', async ({
      tree,
    }) => {
      await runNmr(['fix', '-t', 'a b'], tree.dir);

      expect(readStepsFromCall()?.at(-1)).toStrictEqual({ kind: 'structural', argv: ['nmr', 'fmt', '-t', 'a b'] });
      expect(renderChain(readStepsFromCall() ?? [])).toBe("nmr lint -t 'a b' && nmr fmt -t 'a b'");
    });
  });

  describe('delegation to another host', () => {
    it('refuses a tree-rewriting command under --delegate-to and runs nothing', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--delegate-to', 'box', 'fmt'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('`fmt` cannot be delegated');
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    it('rejects --delegate-to without a host', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--delegate-to'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('--delegate-to requires a host argument');
    });

    it('refuses --delegate-to outside a git repository', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--delegate-to=box', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Cannot delegate to box: not a git repository');
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    it("takes bare --delegate's hosts from NMR_DELEGATE", async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--delegate', 'typecheck'], tree.dir, {
        [DELEGATE_ENV_VAR]: 'box',
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Cannot delegate to box: not a git repository');
    });

    it('refuses --delegate=<hosts>, naming --delegate-to', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--delegate=box', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('--delegate does not take a value; name hosts with --delegate-to box');
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    it('refuses bare --delegate when nothing names a host, naming --delegate-to', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--delegate', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('--delegate needs hosts');
      expect(stderr).toContain('--delegate-to <host,...>');
      expect(mockedRunSteps).not.toHaveBeenCalled();
    });

    it('names --delegate-to when bare --delegate precedes a host name rather than a command', async ({ tree }) => {
      const { exitCode, stderr } = await runNmrReadingStderr(['--delegate', 'box', 'typecheck'], tree.dir, {
        [DELEGATE_ENV_VAR]: 'box',
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown command: box. `box` is not a command; name a host with --delegate-to box');
    });

    it('does not add the host hint to an unknown command without --delegate', async ({ tree }) => {
      const { stderr } = await runNmrReadingStderr(['box'], tree.dir);

      expect(stderr).toContain('Unknown command: box');
      expect(stderr).not.toContain('--delegate-to');
    });

    it('runs a tree-rewriting command here when NMR_DELEGATE names a host', async ({ tree }) => {
      const { exitCode } = await runNmr(['fmt'], tree.dir, { [DELEGATE_ENV_VAR]: 'box' });

      expect(exitCode).toBe(0);
      expect(mockedRunSteps).toHaveBeenCalledTimes(1);
    });

    it('runs here under --no-delegate and withholds NMR_DELEGATE from the steps', async ({ tree }) => {
      const { exitCode } = await runNmr(['--no-delegate', 'lint'], tree.dir, { [DELEGATE_ENV_VAR]: 'box' });

      expect(exitCode).toBe(0);
      expect(mockedRunSteps.mock.calls[0]?.[2].env).not.toHaveProperty(DELEGATE_ENV_VAR);
    });

    it.for([['--delegate'], ['--delegate-to', 'box'], ['--delegate-to=box'], ['--no-delegate']])(
      'warns about %s written after the command name, which then runs here',
      async (flagArgs, { tree }) => {
        const { stderr } = await runNmrReadingStderr(['lint', ...flagArgs], tree.dir);

        expect(stderr).toContain(
          '--delegate, --delegate-to, and --no-delegate after the command name are passed to `lint`, not read by nmr',
        );
        expect(mockedRunSteps).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('misplaced nmr flags', () => {
    const HINT_TAIL = 'nmr reads its flags only before the command:';

    it('names a flag after the command name when the command fails, with the corrected invocation', async ({
      tree,
    }) => {
      mockedRunSteps.mockResolvedValue({ exitCode: 1 });

      const { exitCode, stderr } = await runNmrReadingStderr(['lint', '-q'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(`\`-q\` is an nmr flag; ${HINT_TAIL} \`nmr -q lint\``);
    });

    it.for([
      { args: ['-w', 'lint', '-F', 'my-pkg', 'src/'], expected: '`nmr -w -F my-pkg lint src/`' },
      { args: ['lint', '--output-style=plain', 'src/'], expected: '`nmr --output-style=plain lint src/`' },
      { args: ['lint', '--output-style', 'plain'], expected: '`nmr --output-style plain lint`' },
      { args: ['lint', 'a b', '--no-cache'], expected: "`nmr --no-cache lint 'a b'`" },
      { args: ['lint', '--delegate-to=box'], expected: '`nmr --delegate-to=box lint`' },
      { args: ['lint', '--delegate-to', 'box'], expected: '`nmr --delegate-to box lint`' },
      { args: ['lint', '--delegate', 'src/'], expected: '`nmr --delegate lint src/`' },
    ])(
      'moves $args into a corrected invocation that keeps every other argument',
      async ({ args, expected }, { tree }) => {
        mockedRunSteps.mockResolvedValue({ exitCode: 1 });

        const { stderr } = await runNmrReadingStderr(args, tree.dir);

        expect(stderr).toContain(`${HINT_TAIL} ${expected}`);
      },
    );

    it('names every misplaced flag in one hint', async ({ tree }) => {
      mockedRunSteps.mockResolvedValue({ exitCode: 1 });

      const { stderr } = await runNmrReadingStderr(['lint', '-q', '--no-cache'], tree.dir);

      expect(stderr).toContain(`\`-q\`, \`--no-cache\` are nmr flags; ${HINT_TAIL} \`nmr -q --no-cache lint\``);
    });

    it('hints when nmr refuses the arguments that a command does not take', async ({ tree }) => {
      writeConfig(tree, { rootScripts: { verify: [{ run: 'build', shouldDeclineArguments: true }] } });

      const { exitCode, stderr } = await runNmrReadingStderr(['verify', '-q'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(`${HINT_TAIL} \`nmr -q verify\``);
    });

    it('hints once for a failing delegation', async ({ tree }) => {
      mockedRunSteps.mockResolvedValue({ exitCode: 1 });

      const { stderr } = await runNmrReadingStderr(['-R', 'lint', '-q'], tree.dir);

      expect(stderr.split(HINT_TAIL)).toHaveLength(2);
      expect(stderr).toContain(`${HINT_TAIL} \`nmr -R -q lint\``);
    });

    it('hints for a failing filtered delegation of a command that a package.json defines', async ({ tree }) => {
      tree.writeJson('packages/my-pkg/package.json', { name: 'my-pkg', scripts: { custom: 'echo custom' } });
      mockedRunSteps.mockResolvedValue({ exitCode: 1 });

      const { stderr } = await runNmrReadingStderr(['-F', 'my-pkg', 'custom', '-q'], tree.dir);

      expect(stderr).toContain(`${HINT_TAIL} \`nmr -F my-pkg -q custom\``);
    });

    it.for([
      { case: 'a passing run', args: ['lint', '-q'], exitCode: 0, env: {} },
      {
        case: 'a filtered delegation of an unknown command',
        args: ['-F', 'my-pkg', 'lnt', '-q'],
        exitCode: 1,
        env: {},
      },
      { case: 'a failure without a misplaced flag', args: ['lint', '--max-warnings', '0'], exitCode: 1, env: {} },
      { case: 'an unknown command', args: ['lnt', '-q'], exitCode: 1, env: {} },
      { case: 'a misplaced help flag', args: ['lint', '--help'], exitCode: 1, env: {} },
      { case: 'a misplaced version flag', args: ['lint', '-V'], exitCode: 1, env: {} },
      { case: 'a flag after `--`', args: ['lint', '--', '-q'], exitCode: 1, env: {} },
      { case: 'a run that nmr started', args: ['lint', '-q'], exitCode: 1, env: { NMR_RUN_ID: 'parent-run' } },
    ])('does not hint for $case', async ({ args, env, exitCode }, { tree }) => {
      mockedRunSteps.mockResolvedValue({ exitCode });

      const { stderr } = await runNmrReadingStderr(args, tree.dir, env);

      expect(stderr).not.toContain(HINT_TAIL);
    });
  });

  describe('devBin substitution', () => {
    it('substitutes a leaf tool, which is the case that docs/scripts.md documents', async ({ tree }) => {
      writeConfig(tree, { devBin: { eslint: 'node ./scripts/eslint.js' } });

      await runNmr(['lint'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'opaque', command: `node ${path.join(tree.dir, 'scripts/eslint.js')} --fix .` },
      ]);
    });

    // A composite's first position is nmr's own, not a leaf tool's: substituting it would replace one link of a
    // chain and leave the rest running the published binary.
    it('leaves a composite alone, whose first token is the nmr that runs it', async ({ tree }) => {
      writeConfig(tree, { devBin: { nmr: 'node ./cli.js' } });

      await runNmr(['fix'], tree.dir);

      expect(readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });
  });
});
