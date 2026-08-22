import { writeCacheEntry } from '@williamthorsen/nmr-core';
import type { TempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { resolveBuildCachePath, resolveToolchainFingerprint } from '../build-output.ts';

const SELF_VERSION = '9.9.9';

const it = baseIt
  .extend(
    'tree',
    makeFixture(() => createTempTree({}, { prefix: 'nmr-toolchain-fingerprint-' })),
  )
  .extend('selfDir', ({ tree }) => scaffoldPackage(tree, 'nmr', SELF_VERSION))
  .extend('packageDir', ({ tree }) => scaffoldPackage(tree, 'consumer', '1.0.0'));

describe(resolveToolchainFingerprint, () => {
  it("returns the running nmr's build digest when one is on disk", async ({ packageDir, selfDir }) => {
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'a-build-digest');

    await expect(resolveToolchainFingerprint(packageDir, selfDir)).resolves.toBe('a-build-digest');
  });

  it("returns the running nmr's version when no build digest is on disk", async ({ packageDir, selfDir }) => {
    await expect(resolveToolchainFingerprint(packageDir, selfDir)).resolves.toBe(SELF_VERSION);
  });

  it('returns the version for a build of nmr itself, whatever digest is stored for it', async ({ selfDir }) => {
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'a-build-digest');
    const first = await resolveToolchainFingerprint(selfDir, selfDir);

    // The digest a build writes is the entry this resolution would read, so a self-build that folded it would
    // key itself on its own previous key and never settle.
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'the-next-build-digest');

    await expect(resolveToolchainFingerprint(selfDir, selfDir)).resolves.toBe(first);
    expect(first).toBe(SELF_VERSION);
  });

  it('recognizes a self-build reached through a symlinked path', async ({ selfDir, tree }) => {
    const link = tree.symlink('linked-nmr', selfDir);
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'a-build-digest');

    await expect(resolveToolchainFingerprint(link, selfDir)).resolves.toBe(SELF_VERSION);
  });

  it('resolves a non-empty fingerprint from the running nmr', async ({ packageDir }) => {
    await expect(resolveToolchainFingerprint(packageDir)).resolves.not.toBe('');
  });
});

// region | Helpers

/** Writes a package holding only a `package.json` and a `node_modules`, which keeps its cache entry inside it. */
function scaffoldPackage(tree: TempTree, entry: string, version: string): string {
  tree.writeAll({
    [`${entry}/node_modules/`]: '',
    [`${entry}/package.json`]: JSON.stringify({ name: entry, version }),
  });

  return tree.resolve(entry);
}

// endregion | Helpers
