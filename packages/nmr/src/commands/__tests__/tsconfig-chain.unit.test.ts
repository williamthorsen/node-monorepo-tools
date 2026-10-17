import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeAll, describe, expect, it as baseIt } from 'vitest';

import { loadCompiler } from '../compiler.ts';
import { resolveTsconfigChain } from '../tsconfig-chain.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-build-' })),
);

describe(resolveTsconfigChain, () => {
  beforeAll(async () => {
    await loadCompiler();
  });

  it('returns only the leaf tsconfig when it extends nothing', ({ tree }) => {
    tree.write('pkg/tsconfig.json', JSON.stringify({ compilerOptions: {} }));

    expect(resolveTsconfigChain(tree.resolve('pkg'))).toStrictEqual(['tsconfig.json']);
  });

  it('includes the leaf and each transitively extended base config, relative to the package', ({ tree }) => {
    tree.writeAll({
      'packages/pkg/tsconfig.json': JSON.stringify({ extends: '../../tsconfig.json' }),
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'tsconfig.json': JSON.stringify({ extends: './tsconfig.base.json' }),
    });

    expect(resolveTsconfigChain(tree.resolve('packages/pkg'))).toStrictEqual([
      'tsconfig.json',
      '../../tsconfig.json',
      '../../tsconfig.base.json',
    ]);
  });

  it('throws when a relative extends target does not exist', ({ tree }) => {
    tree.write('pkg/tsconfig.json', JSON.stringify({ extends: './tsconfig.base.json' }));

    expect(() => resolveTsconfigChain(tree.resolve('pkg'))).toThrow(/tsconfig\.base\.json/);
  });

  it('resolves a package specifier whose base is reachable only at its tsconfig.json', ({ tree }) => {
    tree.writeAll({
      // The `@tsconfig/*` family is published in this shape: no `exports` map, config at the package root.
      'pkg/node_modules/@fixture/base/package.json': JSON.stringify({ name: '@fixture/base', version: '1.0.0' }),
      'pkg/node_modules/@fixture/base/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
      'pkg/tsconfig.json': JSON.stringify({ extends: '@fixture/base' }),
    });

    // Node module resolution reports a realpath, which on a symlinked temp root is not `packageDir`-relative.
    const chain = resolveTsconfigChain(tree.resolve('pkg'));
    expect(chain).toHaveLength(2);
    expect(chain[1]).toMatch(/@fixture[/\\]base[/\\]tsconfig\.json$/);
  });

  it('throws when a package-specifier extends target does not resolve', ({ tree }) => {
    tree.write('pkg/tsconfig.json', JSON.stringify({ extends: '@williamthorsen/absent-tsconfig/tsconfig.base.json' }));

    expect(() => resolveTsconfigChain(tree.resolve('pkg'))).toThrow(/absent-tsconfig/);
  });
});
