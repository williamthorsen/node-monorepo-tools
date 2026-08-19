import fs from 'node:fs';
import path from 'node:path';

import { writeCacheEntry } from '@williamthorsen/nmr-core';
import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, test } from 'vitest';

import { resolveBuildCachePath, resolveToolchainFingerprint } from '../build-output.ts';

const SELF_VERSION = '9.9.9';

const it = test
  .extend(
    'tree',
    makeFixture(() => createTempTree({}, { prefix: 'nmr-toolchain-fingerprint-' })),
  )
  .extend('selfDir', ({ tree }) => scaffoldPackage(path.join(tree.dir, 'nmr'), SELF_VERSION))
  .extend('packageDir', ({ tree }) => scaffoldPackage(path.join(tree.dir, 'consumer'), '1.0.0'));

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
    const link = path.join(tree.dir, 'linked-nmr');
    fs.symlinkSync(selfDir, link, 'dir');
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'a-build-digest');

    await expect(resolveToolchainFingerprint(link, selfDir)).resolves.toBe(SELF_VERSION);
  });

  it('resolves a non-empty fingerprint from the running nmr', async ({ packageDir }) => {
    await expect(resolveToolchainFingerprint(packageDir)).resolves.not.toBe('');
  });
});

// region | Helpers

/** Writes a package holding only a `package.json` and a `node_modules`, which keeps its cache entry inside it. */
function scaffoldPackage(dir: string, version: string): string {
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: path.basename(dir), version }));

  return dir;
}

// endregion | Helpers
