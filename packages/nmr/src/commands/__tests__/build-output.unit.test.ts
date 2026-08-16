import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeCacheEntry } from '@williamthorsen/nmr-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveBuildCachePath, resolveToolchainFingerprint } from '../build-output.ts';

describe(resolveToolchainFingerprint, () => {
  const SELF_VERSION = '9.9.9';

  let root: string;
  let selfDir: string;
  let packageDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-toolchain-fingerprint-'));
    selfDir = scaffoldPackage(path.join(root, 'nmr'), SELF_VERSION);
    packageDir = scaffoldPackage(path.join(root, 'consumer'), '1.0.0');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns the running nmr's build digest when one is on disk", async () => {
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'a-build-digest');

    await expect(resolveToolchainFingerprint(packageDir, selfDir)).resolves.toBe('a-build-digest');
  });

  it("returns the running nmr's version when no build digest is on disk", async () => {
    await expect(resolveToolchainFingerprint(packageDir, selfDir)).resolves.toBe(SELF_VERSION);
  });

  it('returns the version for a build of nmr itself, whatever digest is stored for it', async () => {
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'a-build-digest');
    const first = await resolveToolchainFingerprint(selfDir, selfDir);

    // The digest a build writes is the entry this resolution would read, so a self-build that folded it would
    // key itself on its own previous key and never settle.
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'the-next-build-digest');

    await expect(resolveToolchainFingerprint(selfDir, selfDir)).resolves.toBe(first);
    expect(first).toBe(SELF_VERSION);
  });

  it('recognizes a self-build reached through a symlinked path', async () => {
    const link = path.join(root, 'linked-nmr');
    fs.symlinkSync(selfDir, link, 'dir');
    await writeCacheEntry(resolveBuildCachePath(selfDir), 'a-build-digest');

    await expect(resolveToolchainFingerprint(link, selfDir)).resolves.toBe(SELF_VERSION);
  });

  it('resolves a non-empty fingerprint from the running nmr', async () => {
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
