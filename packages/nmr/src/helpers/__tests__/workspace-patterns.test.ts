import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePackageDirs } from '../workspace-patterns.ts';

describe(resolvePackageDirs, () => {
  let root: string;

  /** Creates a directory under the fixture root, with a `package.json` unless `withManifest` is false. */
  function makePackage(relativeDir: string, withManifest = true): string {
    const dir = path.join(root, relativeDir);
    mkdirSync(dir, { recursive: true });
    if (withManifest) {
      writeFileSync(path.join(dir, 'package.json'), '{}');
    }
    return dir;
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'nmr-workspace-patterns-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves a single-level glob to the directories holding a manifest', () => {
    const alpha = makePackage('packages/alpha');
    const beta = makePackage('packages/beta');
    makePackage('packages/no-manifest', false);

    expect(resolvePackageDirs(root, ['packages/*'])).toStrictEqual([alpha, beta]);
  });

  it('resolves an exact path', () => {
    const cli = makePackage('tools/cli');

    expect(resolvePackageDirs(root, ['tools/cli'])).toStrictEqual([cli]);
  });

  it('resolves the workspace root itself', () => {
    makePackage('.');

    expect(resolvePackageDirs(root, ['.'])).toStrictEqual([root]);
  });

  it('omits a directory that a negative pattern excludes', () => {
    const alpha = makePackage('packages/alpha');
    makePackage('packages/legacy');

    expect(resolvePackageDirs(root, ['packages/*', '!packages/legacy'])).toStrictEqual([alpha]);
  });

  it('applies a negative pattern declared before the positive pattern it filters', () => {
    const alpha = makePackage('packages/alpha');
    makePackage('packages/legacy');

    expect(resolvePackageDirs(root, ['!packages/legacy', 'packages/*'])).toStrictEqual([alpha]);
  });

  it('resolves nested packages under a deep glob', () => {
    const alpha = makePackage('packages/alpha');
    const nested = makePackage('packages/alpha/nested');

    expect(resolvePackageDirs(root, ['packages/**'])).toStrictEqual([alpha, nested]);
  });

  it('excludes nested packages matched by a deep negative pattern', () => {
    const alpha = makePackage('packages/alpha');
    makePackage('packages/alpha/test/fixture');

    expect(resolvePackageDirs(root, ['packages/**', '!**/test/**'])).toStrictEqual([alpha]);
  });

  it('never resolves packages inside node_modules', () => {
    const alpha = makePackage('packages/alpha');
    makePackage('packages/alpha/node_modules/installed');
    makePackage('node_modules/installed');

    expect(resolvePackageDirs(root, ['**'])).toStrictEqual([alpha]);
  });

  it('resolves a symlinked package directory', () => {
    const alpha = makePackage('packages/alpha');
    makePackage('external/linked');
    symlinkSync(path.join(root, 'external', 'linked'), path.join(root, 'packages', 'linked'));

    expect(resolvePackageDirs(root, ['packages/*'])).toStrictEqual([alpha, path.join(root, 'packages', 'linked')]);
  });

  it('returns each directory once when patterns overlap', () => {
    const alpha = makePackage('packages/alpha');

    expect(resolvePackageDirs(root, ['packages/*', 'packages/alpha', 'packages/**'])).toStrictEqual([alpha]);
  });

  it('returns directories in a deterministic order', () => {
    const zeta = makePackage('packages/zeta');
    const alpha = makePackage('packages/alpha');
    const mu = makePackage('packages/mu');

    expect(resolvePackageDirs(root, ['packages/*'])).toStrictEqual([alpha, mu, zeta]);
  });

  it('tolerates a trailing slash on a pattern', () => {
    const cli = makePackage('tools/cli');

    expect(resolvePackageDirs(root, ['tools/cli/'])).toStrictEqual([cli]);
  });

  it('returns nothing when every pattern is negative', () => {
    makePackage('packages/alpha');

    expect(resolvePackageDirs(root, ['!packages/legacy'])).toStrictEqual([]);
  });

  it('returns nothing when given no patterns', () => {
    makePackage('packages/alpha');

    expect(resolvePackageDirs(root, [])).toStrictEqual([]);
  });

  // An unquoted `!pkg` entry parses as a YAML tag, so the manifest can hand over an empty pattern.
  it('ignores an empty pattern', () => {
    const alpha = makePackage('packages/alpha');

    expect(resolvePackageDirs(root, ['packages/*', ''])).toStrictEqual([alpha]);
  });
});
