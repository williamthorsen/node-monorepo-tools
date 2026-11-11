import { chmodSync } from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { describe, expect, it } from 'vitest';

import { findPackageManifest, resolveDeclaredCli } from '../package-manifest.ts';
import { isPrivilegedProcess } from '../test-utils/denyAccess.ts';

/** A name that no store contains, so that pnpm's `NODE_PATH` cannot resolve it either. */
const ABSENT_PACKAGE = 'nmr-fixture-package-that-does-not-exist';

const DEPENDENCY_MANIFEST = 'node_modules/dep/package.json';

describe(findPackageManifest, () => {
  it('reports a package that is not installed as absent', () => {
    using tree = createTempTree({ 'package.json': '{}\n' }, { prefix: 'nmr-manifest-' });

    expect(findPackageManifest(tree.resolve('package.json'), ABSENT_PACKAGE)).toStrictEqual({ kind: 'absent' });
  });

  it('returns the parsed manifest and its path', () => {
    using tree = createTempTree(
      { 'package.json': '{}\n', [DEPENDENCY_MANIFEST]: '{"name":"dep","bin":"cli.js"}\n' },
      { prefix: 'nmr-manifest-' },
    );

    expect(findPackageManifest(tree.resolve('package.json'), 'dep')).toStrictEqual({
      kind: 'found',
      manifestPath: tree.resolve(DEPENDENCY_MANIFEST),
      manifest: { name: 'dep', bin: 'cli.js' },
    });
  });

  it('accepts a manifest that starts with a byte-order mark, as Node does', () => {
    using tree = createTempTree(
      { 'package.json': '{}\n', [DEPENDENCY_MANIFEST]: '\u{FEFF}{"name":"dep","bin":"cli.js"}\n' },
      { prefix: 'nmr-manifest-' },
    );

    expect(findPackageManifest(tree.resolve('package.json'), 'dep')).toMatchObject({
      kind: 'found',
      manifest: { bin: 'cli.js' },
    });
  });

  it("reports a malformed dependency manifest as broken, naming the dependency's manifest", () => {
    using tree = createTempTree({ 'package.json': '{}\n', [DEPENDENCY_MANIFEST]: '{\n' }, { prefix: 'nmr-manifest-' });

    const lookup = findPackageManifest(tree.resolve('package.json'), 'dep');

    expect(lookup).toMatchObject({ kind: 'broken' });
    expect(lookup.kind === 'broken' && lookup.cause).toContain(tree.resolve(DEPENDENCY_MANIFEST));
    expect(lookup.kind === 'broken' && lookup.cause).not.toMatch(/\.$/);
  });

  it("reports a malformed manifest of the resolving package as broken, naming that package's manifest", () => {
    using tree = createTempTree(
      { 'package.json': '{\n', [DEPENDENCY_MANIFEST]: '{"name":"dep"}\n' },
      { prefix: 'nmr-manifest-' },
    );

    const lookup = findPackageManifest(tree.resolve('package.json'), 'dep');

    expect(lookup).toMatchObject({ kind: 'broken' });
    expect(lookup.kind === 'broken' && lookup.cause).toContain(tree.resolve('package.json'));
  });

  it.skipIf(isPrivilegedProcess)('reports an unreadable dependency manifest as broken, naming it', () => {
    using tree = createTempTree(
      { 'package.json': '{}\n', [DEPENDENCY_MANIFEST]: '{"name":"dep"}\n' },
      { prefix: 'nmr-manifest-' },
    );
    chmodSync(tree.resolve(DEPENDENCY_MANIFEST), 0o000);

    const lookup = findPackageManifest(tree.resolve('package.json'), 'dep');

    expect(lookup).toMatchObject({ kind: 'broken' });
    expect(lookup.kind === 'broken' && lookup.cause).toContain(tree.resolve(DEPENDENCY_MANIFEST));
  });
});

describe(resolveDeclaredCli, () => {
  const manifestPath = path.join('/store', 'dep', 'package.json');

  it.each([
    ['a bare path', 'bin/cli.js'],
    ['a map keyed by the package name', { other: 'bin/other.js', dep: 'bin/cli.js' }],
  ])('resolves %s against the manifest directory', (_shape, bin) => {
    expect(resolveDeclaredCli({ bin }, manifestPath, 'dep')).toBe(path.join('/store', 'dep', 'bin', 'cli.js'));
  });

  it.each([
    ['a map without the package name', { bin: { other: 'bin/other.js' } }],
    ['a non-string entry', { bin: { dep: 1 } }],
    ['a missing bin', { name: 'dep' }],
    ['a manifest that is not a record', ['bin/cli.js']],
  ])('returns undefined for %s', (_shape, manifest) => {
    expect(resolveDeclaredCli(manifest, manifestPath, 'dep')).toBeUndefined();
  });
});
