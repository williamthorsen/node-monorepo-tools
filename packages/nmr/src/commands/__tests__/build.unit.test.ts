import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeAll, describe, expect, it as baseIt } from 'vitest';

import { buildPackage, computeBuildHash, loadCompiler, resolveTsconfigChain } from '../build.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-build-' })),
);

describe(buildPackage, () => {
  it('names the peer and its supported floor when typescript cannot be resolved', async ({ tree }) => {
    const missing = Object.assign(new Error("Cannot find package 'typescript' imported from /somewhere/build.js"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });

    await expect(
      buildPackage(tree.dir, { style: 'plain', loadTypeScript: () => Promise.reject(missing) }),
    ).rejects.toThrow(
      "nmr-compile requires TypeScript >=5.7, but 'typescript' could not be resolved. Install the 'typescript' peer dependency.",
    );
  });

  it('rethrows any other failure to load the compiler unchanged', async ({ tree }) => {
    const failure = Object.assign(new Error("Cannot find package 'semver' imported from /somewhere/typescript.js"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });

    await expect(
      buildPackage(tree.dir, { style: 'plain', loadTypeScript: () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
  });
});

describe(computeBuildHash, () => {
  beforeAll(async () => {
    await loadCompiler();
  });

  const TOOLCHAIN = { compilerVersion: '5.9.3', fingerprint: 'a-toolchain-fingerprint' };

  it('returns the same digest regardless of entry-point order', async ({ tree }) => {
    tree.writeAll({ 'a.ts': 'export const a = 1;', 'b.ts': 'export const b = 2;' });

    const forwardHash = await computeBuildHash(tree.dir, ['a.ts', 'b.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);
    const reversedHash = await computeBuildHash(tree.dir, ['b.ts', 'a.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);

    expect(reversedHash).toBe(forwardHash);
  });

  it('changes the digest when a file path changes but its content does not', async ({ tree }) => {
    tree.writeAll({ 'a.ts': 'export const x = 1;', 'b.ts': 'export const x = 1;' });

    const asAHash = await computeBuildHash(tree.dir, ['a.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);
    const asBHash = await computeBuildHash(tree.dir, ['b.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);

    expect(asBHash).not.toBe(asAHash);
  });

  it('changes the digest when file content changes', async ({ tree }) => {
    tree.write('a.ts', 'export const x = 1;');
    const beforeHash = await computeBuildHash(tree.dir, ['a.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);

    tree.write('a.ts', 'export const x = 2;');
    const afterHash = await computeBuildHash(tree.dir, ['a.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);

    expect(afterHash).not.toBe(beforeHash);
  });

  it('changes the digest when emit config changes', async ({ tree }) => {
    tree.write('a.ts', 'export const x = 1;');

    const esmHash = await computeBuildHash(tree.dir, ['a.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);
    const otherHash = await computeBuildHash(tree.dir, ['a.ts'], { outdir: 'dist/cjs/' }, TOOLCHAIN);

    expect(otherHash).not.toBe(esmHash);
  });

  it('changes the digest when the compiler version changes', async ({ tree }) => {
    tree.write('a.ts', 'export const x = 1;');

    const underTs59Hash = await computeBuildHash(tree.dir, ['a.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);
    const underTs60Hash = await computeBuildHash(
      tree.dir,
      ['a.ts'],
      { outdir: 'dist/esm/' },
      { ...TOOLCHAIN, compilerVersion: '6.0.3' },
    );

    expect(underTs60Hash).not.toBe(underTs59Hash);
  });

  it('changes the digest when the toolchain fingerprint changes', async ({ tree }) => {
    tree.write('a.ts', 'export const x = 1;');

    const underOneHash = await computeBuildHash(tree.dir, ['a.ts'], { outdir: 'dist/esm/' }, TOOLCHAIN);
    const underNextHash = await computeBuildHash(
      tree.dir,
      ['a.ts'],
      { outdir: 'dist/esm/' },
      { ...TOOLCHAIN, fingerprint: 'the-next-fingerprint' },
    );

    expect(underNextHash).not.toBe(underOneHash);
  });

  it('changes the digest when an extended base config in the chain changes', async ({ tree }) => {
    tree.writeAll({
      'base.json': JSON.stringify({ compilerOptions: { target: 'ES2022' } }),
      'pkg/package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
      'pkg/tsconfig.json': JSON.stringify({ extends: '../base.json' }),
    });
    const packageDir = tree.resolve('pkg');

    // The base config is reachable only through `extends`; the leaf tsconfig stays byte-identical.
    const files = ['package.json', ...resolveTsconfigChain(packageDir)];
    const beforeHash = await computeBuildHash(packageDir, files, { outdir: 'dist/esm/' }, TOOLCHAIN);

    tree.write('base.json', JSON.stringify({ compilerOptions: { target: 'ES2021' } }));
    const afterHash = await computeBuildHash(packageDir, files, { outdir: 'dist/esm/' }, TOOLCHAIN);

    expect(afterHash).not.toBe(beforeHash);
  });
});

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
