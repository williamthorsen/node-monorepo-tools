import { realpathSync } from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { enterChain, ENTRY_CHAIN_ENV_VAR } from '../entry-chain.ts';
import { UserError } from '../UserError.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({ 'packages/my-pkg/package.json': '{}' }, { prefix: 'nmr-entry-chain-' })),
);

describe(enterChain, () => {
  it('starts a chain when none is inherited', ({ tree }) => {
    const env = enterChain({ anchorDir: tree.dir, command: 'build', env: {}, monorepoRoot: tree.dir });

    expect(readChain(env)).toStrictEqual([{ command: 'build', dir: realpathSync(tree.dir) }]);
  });

  it('appends to the inherited chain and keeps the rest of the environment', ({ tree }) => {
    const root = realpathSync(tree.dir);
    const inherited = [{ command: 'build', dir: root }];

    const env = enterChain({
      anchorDir: path.join(tree.dir, 'packages/my-pkg'),
      command: 'build',
      env: { [ENTRY_CHAIN_ENV_VAR]: JSON.stringify(inherited), OTHER: 'kept' },
      monorepoRoot: tree.dir,
    });

    expect(readChain(env)).toStrictEqual([...inherited, { command: 'build', dir: path.join(root, 'packages/my-pkg') }]);
    expect(env['OTHER']).toBe('kept');
  });

  it.for([
    { scenario: 'another command in the same directory', command: 'build:pre', dir: '.' },
    { scenario: 'the same command in another directory', command: 'build', dir: 'packages/my-pkg' },
  ])('admits $scenario', ({ command, dir }, { tree }) => {
    const inherited = [{ command: 'build', dir: realpathSync(tree.dir) }];

    expect(() =>
      enterChain({
        anchorDir: path.join(tree.dir, dir),
        command,
        env: { [ENTRY_CHAIN_ENV_VAR]: JSON.stringify(inherited) },
        monorepoRoot: tree.dir,
      }),
    ).not.toThrow();
  });

  it('rejects a repeat, naming the command and directory and listing the chain', ({ tree }) => {
    const root = realpathSync(tree.dir);
    const inherited = [
      { command: 'build', dir: root },
      { command: 'build', dir: path.join(root, 'packages/my-pkg') },
    ];

    expect(() =>
      enterChain({
        anchorDir: tree.dir,
        command: 'build',
        env: { [ENTRY_CHAIN_ENV_VAR]: JSON.stringify(inherited) },
        monorepoRoot: tree.dir,
      }),
    ).toThrow(
      new UserError(
        [
          'nmr re-entered `build` in root, which this run is already running there, so the run would never end. ' +
            'The entries that this run has entered, outermost first:',
          '  build in root  (repeat)',
          '  build in packages/my-pkg',
          '  build in root  (repeat)',
        ].join('\n'),
      ),
    );
  });

  // The symlink stands for a path that one process reaches by its link and another by its target.
  it('recognizes a repeat reached through a symlinked directory', ({ tree }) => {
    const target = path.join(tree.dir, 'packages/my-pkg');
    const link = tree.symlink('links/my-pkg', target);
    const inherited = [{ command: 'build', dir: realpathSync(target) }];

    expect(() =>
      enterChain({
        anchorDir: link,
        command: 'build',
        env: { [ENTRY_CHAIN_ENV_VAR]: JSON.stringify(inherited) },
        monorepoRoot: tree.dir,
      }),
    ).toThrow(UserError);
  });

  it.for([
    { scenario: 'text that is not JSON', value: 'build' },
    { scenario: 'JSON that is not a list', value: '{"command":"build"}' },
    { scenario: 'a list whose entry lacks a directory', value: '[{"command":"build"}]' },
  ])('rejects an inherited chain that is $scenario, naming the variable', ({ value }, { tree }) => {
    expect(() =>
      enterChain({
        anchorDir: tree.dir,
        command: 'build',
        env: { [ENTRY_CHAIN_ENV_VAR]: value },
        monorepoRoot: tree.dir,
      }),
    ).toThrow(ENTRY_CHAIN_ENV_VAR);
  });

  it('reads an empty value as an empty chain', ({ tree }) => {
    const env = enterChain({
      anchorDir: tree.dir,
      command: 'build',
      env: { [ENTRY_CHAIN_ENV_VAR]: '' },
      monorepoRoot: tree.dir,
    });

    expect(readChain(env)).toHaveLength(1);
  });
});

// region | Helpers

/** Parses the chain that an environment carries. */
function readChain(env: NodeJS.ProcessEnv): unknown {
  return JSON.parse(env[ENTRY_CHAIN_ENV_VAR] ?? 'null');
}

// endregion | Helpers
