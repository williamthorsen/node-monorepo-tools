import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { resolvePackageDirs } from '../workspace-patterns.ts';

describe(resolvePackageDirs, () => {
  let tree: TempTree;

  /** Creates a directory under the fixture root, with a `package.json` unless `withManifest` is false. */
  function makePackage(relativeDir: string, withManifest = true): string {
    const dir = tree.mkdir(relativeDir);
    if (withManifest) {
      tree.write(`${relativeDir}/package.json`, '{}');
    }
    return dir;
  }

  beforeEach(() => {
    tree = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-workspace-patterns-' }));
  });

  it('resolves a single-level glob to the directories holding a manifest', () => {
    const alphaDir = makePackage('packages/alpha');
    const betaDir = makePackage('packages/beta');
    makePackage('packages/no-manifest', false);

    expect(resolvePackageDirs(tree.dir, ['packages/*'])).toStrictEqual([alphaDir, betaDir]);
  });

  it('resolves an exact path', () => {
    const cli = makePackage('tools/cli');

    expect(resolvePackageDirs(tree.dir, ['tools/cli'])).toStrictEqual([cli]);
  });

  it('resolves the workspace root itself', () => {
    makePackage('.');

    expect(resolvePackageDirs(tree.dir, ['.'])).toStrictEqual([tree.dir]);
  });

  it('omits a directory that a negative pattern excludes', () => {
    const alphaDir = makePackage('packages/alpha');
    makePackage('packages/legacy');

    expect(resolvePackageDirs(tree.dir, ['packages/*', '!packages/legacy'])).toStrictEqual([alphaDir]);
  });

  it('applies a negative pattern declared before the positive pattern it filters', () => {
    const alphaDir = makePackage('packages/alpha');
    makePackage('packages/legacy');

    expect(resolvePackageDirs(tree.dir, ['!packages/legacy', 'packages/*'])).toStrictEqual([alphaDir]);
  });

  it('resolves nested packages under a deep glob', () => {
    const alphaDir = makePackage('packages/alpha');
    const nestedDir = makePackage('packages/alpha/nested');

    expect(resolvePackageDirs(tree.dir, ['packages/**'])).toStrictEqual([alphaDir, nestedDir]);
  });

  it('excludes nested packages matched by a deep negative pattern', () => {
    const alphaDir = makePackage('packages/alpha');
    makePackage('packages/alpha/test/fixture');

    expect(resolvePackageDirs(tree.dir, ['packages/**', '!**/test/**'])).toStrictEqual([alphaDir]);
  });

  it('never resolves packages inside node_modules', () => {
    const alphaDir = makePackage('packages/alpha');
    makePackage('packages/alpha/node_modules/installed');
    makePackage('node_modules/installed');

    expect(resolvePackageDirs(tree.dir, ['**'])).toStrictEqual([alphaDir]);
  });

  it('resolves a symlinked package directory', () => {
    const alphaDir = makePackage('packages/alpha');
    makePackage('external/linked');
    const link = tree.symlink('packages/linked', tree.resolve('external/linked'));

    expect(resolvePackageDirs(tree.dir, ['packages/*'])).toStrictEqual([alphaDir, link]);
  });

  it('returns each directory once when patterns overlap', () => {
    const alphaDir = makePackage('packages/alpha');

    expect(resolvePackageDirs(tree.dir, ['packages/*', 'packages/alpha', 'packages/**'])).toStrictEqual([alphaDir]);
  });

  it('returns directories in a deterministic order', () => {
    const zetaDir = makePackage('packages/zeta');
    const alphaDir = makePackage('packages/alpha');
    const muDir = makePackage('packages/mu');

    expect(resolvePackageDirs(tree.dir, ['packages/*'])).toStrictEqual([alphaDir, muDir, zetaDir]);
  });

  it('tolerates a trailing slash on a pattern', () => {
    const cli = makePackage('tools/cli');

    expect(resolvePackageDirs(tree.dir, ['tools/cli/'])).toStrictEqual([cli]);
  });

  it('returns nothing when every pattern is negative', () => {
    makePackage('packages/alpha');

    expect(resolvePackageDirs(tree.dir, ['!packages/legacy'])).toStrictEqual([]);
  });

  it('returns nothing when given no patterns', () => {
    makePackage('packages/alpha');

    expect(resolvePackageDirs(tree.dir, [])).toStrictEqual([]);
  });

  // An unquoted `!pkg` entry parses as a YAML tag, so the manifest can hand over an empty pattern.
  it('ignores an empty pattern', () => {
    const alphaDir = makePackage('packages/alpha');

    expect(resolvePackageDirs(tree.dir, ['packages/*', ''])).toStrictEqual([alphaDir]);
  });
});
