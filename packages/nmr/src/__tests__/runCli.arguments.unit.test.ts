import path from 'node:path';

import { describe, expect } from 'vitest';

import { DELEGATE_ENV_VAR } from '../delegation/remote-run.ts';
import type { FilterSelection } from '../helpers/filter-selection.ts';
import { runCli } from '../runCli.ts';
import { renderChain } from '../steps.ts';
import { it } from '../test-utils/run-cli-fixtures.ts';
import { writeConfig } from '../test-utils/run-cli-harness.ts';

describe(runCli, () => {
  describe('input', () => {
    it('withholds stdin from the packages of a recursive delegate', async ({ nmr, tree }) => {
      await nmr.run(['-R', 'build'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['pnpm', '--recursive', 'exec', 'nmr', 'build'], shouldWithholdInput: true },
      ]);
    });

    it('withholds stdin from the packages of a filter selecting several', async ({ nmr, tree }) => {
      nmr.readFilterSelection.mockReturnValue('multiple');

      await nmr.run(['-F', './packages/*', 'build'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        {
          kind: 'structural',
          argv: ['pnpm', '--filter', './packages/*', 'exec', 'nmr', 'build'],
          shouldWithholdInput: true,
        },
      ]);
    });

    it.for<{ selection: FilterSelection }>([{ selection: 'single' }, { selection: 'unresolved' }])(
      'given a filter whose selection reads $selection, keeps nmr stdin',
      async ({ selection }, { nmr, tree }) => {
        nmr.readFilterSelection.mockReturnValue(selection);

        await nmr.run(['-F', 'my-pkg', 'build'], tree.dir);

        expect(nmr.readStepsFromCall()).toStrictEqual([
          { kind: 'structural', argv: ['pnpm', '--filter', 'my-pkg', 'exec', 'nmr', 'build'] },
        ]);
      },
    );

    it('asks pnpm once for both the refusal and the input', async ({ nmr, tree }) => {
      nmr.readFilterSelection.mockReturnValue('multiple');

      await nmr.run(['-F', './packages/*', 'build'], tree.dir);

      expect(nmr.readFilterSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe('step composition', () => {
    it('resolves a composite to one structural step per element', async ({ nmr, tree }) => {
      await nmr.run(['fix'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint'] },
        { kind: 'structural', argv: ['nmr', 'fmt'] },
      ]);
    });

    it('resolves a string script to one opaque step', async ({ nmr, tree }) => {
      await nmr.run(['lint'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([{ kind: 'opaque', command: 'eslint --fix .' }]);
    });

    it('propagates `-w` to each element, so that a child selects the root registry on its own', async ({
      nmr,
      tree,
    }) => {
      await nmr.run(['-w', 'fix'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', '-w', 'lint'] },
        { kind: 'structural', argv: ['nmr', '-w', 'fmt'] },
      ]);
    });

    it('wraps a command in the hooks that resolve, as structural steps of their own', async ({ nmr, tree }) => {
      writeConfig(tree, { rootScripts: { 'lint:post': 'echo done', 'lint:pre': 'echo starting' } });

      await nmr.run(['lint'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'lint:pre'] },
        { kind: 'opaque', command: 'eslint --fix .' },
        { kind: 'structural', argv: ['nmr', 'lint:post'] },
      ]);
    });
  });

  describe('passthrough arguments', () => {
    it('binds to every element of a composite and never to a hook', async ({ nmr, tree }) => {
      writeConfig(tree, { rootScripts: { 'fix:post': 'echo done', 'fix:pre': 'echo starting' } });

      await nmr.run(['fix', '--dry-run'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'fix:pre'] },
        { kind: 'structural', argv: ['nmr', 'lint', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fmt', '--dry-run'] },
        { kind: 'structural', argv: ['nmr', 'fix:post'] },
      ]);
    });

    it('leaves a declining element unnarrowed', async ({ nmr, tree }) => {
      writeConfig(tree, {
        rootScripts: { verify: [{ run: 'build', shouldDeclineArguments: true }, 'lint'] },
      });

      await nmr.run(['verify', 'src/'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'structural', argv: ['nmr', 'build'], shouldDeclineArguments: true },
        { kind: 'structural', argv: ['nmr', 'lint', 'src/'] },
      ]);
    });

    it('runs nothing when every element declines them, naming the command', async ({ nmr, tree }) => {
      writeConfig(tree, {
        rootScripts: {
          verify: [
            { run: 'build', shouldDeclineArguments: true },
            { run: 'lint', shouldDeclineArguments: true },
          ],
        },
      });

      const { exitCode, stderr } = await nmr.runReadingStderr(['verify', 'src/'], tree.dir);

      expect(exitCode).toBe(2);
      expect(nmr.readStepsFromCall()).toBeUndefined();
      expect(stderr).toContain('`verify` does not take trailing arguments');
    });

    // The rejection precedes the recording branch, so `--log` rejects an unroutable argument as a run does,
    // rather than reporting that nothing was recorded.
    it('rejects an unroutable argument under --log too', async ({ nmr, tree }) => {
      writeConfig(tree, {
        rootScripts: {
          verify: [
            { run: 'build', shouldDeclineArguments: true },
            { run: 'lint', shouldDeclineArguments: true },
          ],
        },
      });

      const { exitCode, stderr } = await nmr.runReadingStderr(['--log', 'verify', 'src/'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('`verify` does not take trailing arguments');
    });

    // An empty override resolves to an empty step list, which does not have a step to accept the arguments.
    // The no-op check precedes the rejection so that the override keeps reporting as a no-op.
    it('reports an empty override as a no-op rather than rejecting the argument', async ({ nmr, tree }) => {
      writeConfig(tree, { rootScripts: { verify: [] } });

      const { exitCode, stdout } = await nmr.runReadingStdout(['verify', 'src/'], tree.dir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('verify: skipped, the override is empty');
    });

    it('binds to a string script as shell-quoted text', async ({ nmr, tree }) => {
      await nmr.run(['lint', '--max-warnings', '0'], tree.dir);

      expect(nmr.readStepsFromCall()).toStrictEqual([
        { kind: 'opaque', command: "eslint --fix . '--max-warnings' '0'" },
      ]);
    });

    it('quotes a structural argument once, while the chain string quotes only what the shell would act on', async ({
      nmr,
      tree,
    }) => {
      await nmr.run(['fix', '-t', 'a b'], tree.dir);

      expect(nmr.readStepsFromCall()?.at(-1)).toStrictEqual({ kind: 'structural', argv: ['nmr', 'fmt', '-t', 'a b'] });
      expect(renderChain(nmr.readStepsFromCall() ?? [])).toBe("nmr lint -t 'a b' && nmr fmt -t 'a b'");
    });
  });

  describe('delegation to another host', () => {
    it('refuses a tree-rewriting command under --delegate-to and runs nothing', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--delegate-to', 'box', 'fmt'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('`fmt` cannot be delegated');
      expect(nmr.runSteps).not.toHaveBeenCalled();
    });

    it('rejects --delegate-to without a host', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--delegate-to'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('Missing value for option: --delegate-to');
    });

    it('refuses --delegate-to outside a git repository', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--delegate-to=box', 'typecheck'], tree.dir);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Cannot delegate to box: not a git repository');
      expect(nmr.runSteps).not.toHaveBeenCalled();
    });

    it("takes bare --delegate's hosts from NMR_DELEGATE", async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--delegate', 'typecheck'], tree.dir, {
        [DELEGATE_ENV_VAR]: 'box',
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Cannot delegate to box: not a git repository');
    });

    it('refuses --delegate=<hosts> as a value given to a boolean flag', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--delegate=box', 'typecheck'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('--delegate');
      expect(nmr.runSteps).not.toHaveBeenCalled();
    });

    it('refuses bare --delegate when nothing names a host, naming --delegate-to', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--delegate', 'typecheck'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain('--delegate needs hosts');
      expect(stderr).toContain('--delegate-to <host,...>');
      expect(nmr.runSteps).not.toHaveBeenCalled();
    });

    it('names --delegate-to when bare --delegate precedes a host name rather than a command', async ({ nmr, tree }) => {
      const { exitCode, stderr } = await nmr.runReadingStderr(['--delegate', 'box', 'typecheck'], tree.dir, {
        [DELEGATE_ENV_VAR]: 'box',
      });

      expect(exitCode).toBe(2);
      expect(stderr).toContain('Unknown command: box. `box` is not a command; name a host with --delegate-to box');
    });

    it('does not add the host hint to an unknown command without --delegate', async ({ nmr, tree }) => {
      const { stderr } = await nmr.runReadingStderr(['box'], tree.dir);

      expect(stderr).toContain('Unknown command: box');
      expect(stderr).not.toContain('--delegate-to');
    });

    it('runs a tree-rewriting command here when NMR_DELEGATE names a host', async ({ nmr, tree }) => {
      const { exitCode } = await nmr.run(['fmt'], tree.dir, { [DELEGATE_ENV_VAR]: 'box' });

      expect(exitCode).toBe(0);
      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
    });

    it('runs here under --no-delegate and passes an empty NMR_DELEGATE to the steps', async ({ nmr, tree }) => {
      const { exitCode } = await nmr.run(['--no-delegate', 'lint'], tree.dir, { [DELEGATE_ENV_VAR]: 'box' });

      expect(exitCode).toBe(0);
      expect(nmr.runSteps.mock.calls[0]?.[2].env).toHaveProperty(DELEGATE_ENV_VAR, '');
    });

    it.for([['--delegate'], ['--delegate-to', 'box'], ['--delegate-to=box'], ['--no-delegate']])(
      'warns about %s written after the command name, which then runs here',
      async (flagArgs, { nmr, tree }) => {
        const { stderr } = await nmr.runReadingStderr(['lint', ...flagArgs], tree.dir);

        expect(stderr).toContain(
          '--delegate, --delegate-to, and --no-delegate after the command name are passed to `lint`, not read by nmr',
        );
        expect(nmr.runSteps).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('delegation by the user config', () => {
    const ALWAYS = `export default { delegate: { hosts: ['imac2'], when: 'always' } };`;

    it('reads the user config under XDG_CONFIG_HOME and delegates to its hosts', async ({ nmr, tree }) => {
      tree.write('xdg/nmr/config.ts', ALWAYS);

      const { stderr } = await nmr.runReadingStderr(['typecheck'], tree.dir, {
        XDG_CONFIG_HOME: path.join(tree.dir, 'xdg'),
      });

      expect(stderr).toContain('running typecheck here rather than on imac2: not a git repository');
      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
    });

    it('reads the user config under HOME when XDG_CONFIG_HOME is unset', async ({ nmr, tree }) => {
      tree.write('.config/nmr/config.ts', ALWAYS);

      const { stderr } = await nmr.runReadingStderr(['typecheck'], tree.dir, { HOME: tree.dir });

      expect(stderr).toContain('rather than on imac2');
    });

    it('runs here without reading the user config when the repo declares delegate: false', async ({ nmr, tree }) => {
      writeConfig(tree, { delegate: false });
      tree.write('xdg/nmr/config.ts', `export default { delegate: 'invalid' };`);

      const { exitCode, stderr } = await nmr.runReadingStderr(['typecheck'], tree.dir, {
        XDG_CONFIG_HOME: path.join(tree.dir, 'xdg'),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
    });

    it('fails a run that reaches the user config when the config is invalid, naming the file and the key', async ({
      nmr,
      tree,
    }) => {
      tree.write('xdg/nmr/config.ts', `export default { delegate: { when: 'agent' } };`);

      await expect(
        nmr.runReadingStderr(['typecheck'], tree.dir, { XDG_CONFIG_HOME: path.join(tree.dir, 'xdg') }),
      ).rejects.toThrow(
        `Invalid nmr config at ${path.join(tree.dir, 'xdg', 'nmr', 'config.ts')}: \`delegate.hosts\` must be`,
      );
      expect(nmr.runSteps).not.toHaveBeenCalled();
    });

    it('runs a -F invocation here, and its children with an empty NMR_DELEGATE', async ({ nmr, tree }) => {
      tree.write('xdg/nmr/config.ts', ALWAYS);

      const { stderr } = await nmr.runReadingStderr(['-F', 'my-pkg', 'typecheck'], tree.dir, {
        XDG_CONFIG_HOME: path.join(tree.dir, 'xdg'),
      });

      expect(stderr).not.toContain('imac2');
      expect(nmr.runSteps).toHaveBeenCalledTimes(1);
      expect(nmr.runSteps.mock.calls[0]?.[2].env).toHaveProperty(DELEGATE_ENV_VAR, '');
    });

    it('passes an empty NMR_DELEGATE to the steps of a run that the user config left here', async ({ nmr, tree }) => {
      tree.write('xdg/nmr/config.ts', `export default { delegate: { hosts: ['imac2'], when: 'agent' } };`);

      await nmr.run(['lint'], tree.dir, { XDG_CONFIG_HOME: path.join(tree.dir, 'xdg') });

      expect(nmr.runSteps.mock.calls[0]?.[2].env).toHaveProperty(DELEGATE_ENV_VAR, '');
    });
  });

  describe('the debug note naming what sent a command to a host', () => {
    it.for([
      { case: '--delegate-to', args: ['--delegate-to', 'box', 'typecheck'], env: {}, expected: 'per --delegate-to' },
      {
        case: '--delegate',
        args: ['--delegate', 'typecheck'],
        env: { [DELEGATE_ENV_VAR]: 'box' },
        expected: 'per --delegate',
      },
      { case: 'NMR_DELEGATE', args: ['typecheck'], env: { [DELEGATE_ENV_VAR]: 'box' }, expected: 'per NMR_DELEGATE' },
      {
        case: 'the user config',
        args: ['typecheck'],
        env: { CLAUDECODE: '1' },
        hasUserConfig: true,
        expected: 'per ~/.config/nmr/config.ts (when: agent)',
      },
    ])('names $case', async ({ args, env, expected, hasUserConfig = false }, { nmr, tree }) => {
      tree.write('.config/nmr/config.ts', `export default { delegate: { hosts: ['box'], when: 'agent' } };`);
      const homeEnv = hasUserConfig ? { HOME: tree.dir } : {};

      const { stderr } = await nmr.runReadingStderr(args, tree.dir, { ...env, ...homeEnv, NMR_DEBUG: '1' });

      expect(stderr).toContain(`delegating typecheck ${expected}\n`);
    });

    it('is silent without NMR_DEBUG', async ({ nmr, tree }) => {
      const { stderr } = await nmr.runReadingStderr(['typecheck'], tree.dir, { [DELEGATE_ENV_VAR]: 'box' });

      expect(stderr).not.toContain('delegating');
    });
  });

  describe('misplaced nmr flags', () => {
    const HINT_TAIL = 'nmr reads its flags only before the command:';

    it('names a flag after the command name when the command fails, with the corrected invocation', async ({
      nmr,
      tree,
    }) => {
      nmr.runSteps.mockResolvedValue({ exitCode: 1 });

      const { exitCode, stderr } = await nmr.runReadingStderr(['lint', '-q'], tree.dir);

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
      async ({ args, expected }, { nmr, tree }) => {
        nmr.runSteps.mockResolvedValue({ exitCode: 1 });

        const { stderr } = await nmr.runReadingStderr(args, tree.dir);

        expect(stderr).toContain(`${HINT_TAIL} ${expected}`);
      },
    );

    it('names every misplaced flag in one hint', async ({ nmr, tree }) => {
      nmr.runSteps.mockResolvedValue({ exitCode: 1 });

      const { stderr } = await nmr.runReadingStderr(['lint', '-q', '--no-cache'], tree.dir);

      expect(stderr).toContain(`\`-q\`, \`--no-cache\` are nmr flags; ${HINT_TAIL} \`nmr -q --no-cache lint\``);
    });

    it('hints when nmr refuses the arguments that a command does not take', async ({ nmr, tree }) => {
      writeConfig(tree, { rootScripts: { verify: [{ run: 'build', shouldDeclineArguments: true }] } });

      const { exitCode, stderr } = await nmr.runReadingStderr(['verify', '-q'], tree.dir);

      expect(exitCode).toBe(2);
      expect(stderr).toContain(`${HINT_TAIL} \`nmr -q verify\``);
    });

    it('hints once for a failing delegation', async ({ nmr, tree }) => {
      nmr.runSteps.mockResolvedValue({ exitCode: 1 });

      const { stderr } = await nmr.runReadingStderr(['-R', 'lint', '-q'], tree.dir);

      expect(stderr.split(HINT_TAIL)).toHaveLength(2);
      expect(stderr).toContain(`${HINT_TAIL} \`nmr -R -q lint\``);
    });

    it('hints for a failing filtered delegation of a command that a package.json defines', async ({ nmr, tree }) => {
      tree.writeJson('packages/my-pkg/package.json', { name: 'my-pkg', scripts: { custom: 'echo custom' } });
      nmr.runSteps.mockResolvedValue({ exitCode: 1 });

      const { stderr } = await nmr.runReadingStderr(['-F', 'my-pkg', 'custom', '-q'], tree.dir);

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
    ])('does not hint for $case', async ({ args, env, exitCode }, { nmr, tree }) => {
      nmr.runSteps.mockResolvedValue({ exitCode });

      const { stderr } = await nmr.runReadingStderr(args, tree.dir, env);

      expect(stderr).not.toContain(HINT_TAIL);
    });
  });
});
