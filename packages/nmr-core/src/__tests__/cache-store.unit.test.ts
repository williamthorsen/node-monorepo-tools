import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import {
  readCacheEntry,
  readJsonCacheEntry,
  removeCacheDir,
  removeCacheEntry,
  resolveCacheDir,
  resolveCacheEntryPath,
  writeCacheEntry,
} from '../cache-store.ts';

const TOOL = 'test-tool';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-cache-store-' })),
);

describe('cache-store', () => {
  describe(resolveCacheDir, () => {
    it('places the cache under the scope directory’s own node_modules', ({ tree }) => {
      tree.mkdir('node_modules');

      expect(resolveCacheDir({ tool: TOOL, scopeDir: tree.dir })).toBe(
        path.join(tree.dir, 'node_modules', '.cache', TOOL),
      );
    });

    it('hoists to the nearest ancestor containing a node_modules', ({ tree }) => {
      // A zero-dependency package does not have a `node_modules` of its own; materializing one to store a cache
      // would leave a directory that the package never asked for.
      tree.mkdir('node_modules');
      const packageDir = tree.mkdir('packages/leaf');

      expect(resolveCacheDir({ tool: TOOL, scopeDir: packageDir })).toBe(
        path.join(tree.dir, 'node_modules', '.cache', TOOL),
      );
    });

    it('falls back to the scope directory when its ancestors lack a node_modules', ({ tree }) => {
      expect(resolveCacheDir({ tool: TOOL, scopeDir: tree.dir })).toBe(
        path.join(tree.dir, 'node_modules', '.cache', TOOL),
      );
    });
  });

  describe(resolveCacheEntryPath, () => {
    it('is stable across calls for the same reference', ({ tree }) => {
      const ref = { tool: TOOL, scopeDir: tree.dir, slug: 'alpha', extension: '.json' };

      expect(resolveCacheEntryPath(ref)).toBe(resolveCacheEntryPath(ref));
    });

    it('names the entry with its slug and extension', ({ tree }) => {
      const entryPath = resolveCacheEntryPath({ tool: TOOL, scopeDir: tree.dir, slug: 'alpha', extension: '.hash' });

      expect(path.basename(entryPath)).toMatch(/^alpha-[\da-f]{8}\.hash$/);
    });

    it('separates scopes sharing one cache directory', ({ tree }) => {
      // Two packages hoisting to the same `node_modules` would otherwise write over each other's entries.
      tree.mkdir('node_modules');
      const a = path.join(tree.dir, 'packages', 'a');
      const b = path.join(tree.dir, 'packages', 'b');

      const pathA = resolveCacheEntryPath({ tool: TOOL, scopeDir: a, slug: 'pkg', extension: '.json' });
      const pathB = resolveCacheEntryPath({ tool: TOOL, scopeDir: b, slug: 'pkg', extension: '.json' });

      expect(pathA).not.toBe(pathB);
      expect(path.dirname(pathA)).toBe(path.dirname(pathB));
    });

    it('separates entries in one scope by their discriminators', ({ tree }) => {
      const base = { tool: TOOL, scopeDir: tree.dir, slug: 'entry', extension: '.json' };

      expect(resolveCacheEntryPath({ ...base, discriminators: ['check'] })).not.toBe(
        resolveCacheEntryPath({ ...base, discriminators: ['check:strict'] }),
      );
    });

    it('ignores an empty discriminator list, so adding the field cannot move an existing entry', ({ tree }) => {
      const base = { tool: TOOL, scopeDir: tree.dir, slug: 'entry', extension: '.hash' };

      expect(resolveCacheEntryPath({ ...base, discriminators: [] })).toBe(resolveCacheEntryPath(base));
    });
  });

  describe(readCacheEntry, () => {
    it('returns the entry’s text', async ({ tree }) => {
      const entryPath = tree.write('entry.hash', 'a-digest');

      await expect(readCacheEntry(entryPath)).resolves.toBe('a-digest');
    });

    it('reads a missing entry as a miss rather than an error', async ({ tree }) => {
      await expect(readCacheEntry(path.join(tree.dir, 'absent.hash'))).resolves.toBeUndefined();
    });

    it('reads a directory in the entry’s place as a miss', async ({ tree }) => {
      const entryPath = tree.mkdir('entry.hash');

      await expect(readCacheEntry(entryPath)).resolves.toBeUndefined();
    });
  });

  describe(readJsonCacheEntry, () => {
    it('returns the parsed entry when it satisfies the guard', async ({ tree }) => {
      const entryPath = tree.writeJson('entry.json', { hash: 'abc' });

      await expect(readJsonCacheEntry(entryPath, isHashEntry)).resolves.toStrictEqual({ hash: 'abc' });
    });

    it('reads a missing entry as a miss', async ({ tree }) => {
      await expect(readJsonCacheEntry(path.join(tree.dir, 'absent.json'), isHashEntry)).resolves.toBeUndefined();
    });

    it('reads unparseable content as a miss', async ({ tree }) => {
      // A truncated entry must not make the read throw at the caller.
      const entryPath = tree.write('entry.json', '{"hash": "abc');

      await expect(readJsonCacheEntry(entryPath, isHashEntry)).resolves.toBeUndefined();
    });

    it('reads content of the wrong shape as a miss', async ({ tree }) => {
      // An entry written in an older format is content that the caller cannot trust, so the read must not return it.
      const entryPath = tree.writeJson('entry.json', { digest: 'abc' });

      await expect(readJsonCacheEntry(entryPath, isHashEntry)).resolves.toBeUndefined();
    });
  });

  describe(writeCacheEntry, () => {
    it('creates the cache directory on the way', async ({ tree }) => {
      const entryPath = resolveCacheEntryPath({ tool: TOOL, scopeDir: tree.dir, slug: 'alpha', extension: '.hash' });

      await writeCacheEntry(entryPath, 'a-digest');

      expect(fs.readFileSync(entryPath, 'utf8')).toBe('a-digest');
    });

    it('replaces an existing entry', async ({ tree }) => {
      const entryPath = path.join(tree.dir, 'entry.hash');

      await writeCacheEntry(entryPath, 'first');
      await writeCacheEntry(entryPath, 'second');

      expect(fs.readFileSync(entryPath, 'utf8')).toBe('second');
    });

    it('does not leave a temporary file behind', async ({ tree }) => {
      const entryPath = path.join(tree.dir, 'entry.hash');

      await writeCacheEntry(entryPath, 'a-digest');

      expect(fs.readdirSync(tree.dir)).toStrictEqual(['entry.hash']);
    });

    it('never exposes a half-written entry to a concurrent reader', async ({ tree }) => {
      // Each read races the write, so a truncated prefix in `observed` would mean that the write is not atomic.
      const entryPath = path.join(tree.dir, 'entry.hash');
      const previous = 'p'.repeat(1_000_000);
      const next = 'n'.repeat(1_000_000);
      await writeCacheEntry(entryPath, previous);

      const observed: Array<string | undefined> = [];
      const writing = writeCacheEntry(entryPath, next);
      for (let attempt = 0; attempt < 200; attempt++) {
        observed.push(await readCacheEntry(entryPath));
      }
      await writing;

      expect(observed.every((value) => value === previous || value === next)).toBe(true);
    });

    it('reports a write that it could not complete, without leaving a temporary file behind', async ({ tree }) => {
      // A cache that silently fails to record is a cache that never hits, with nothing to explain why.
      const entryPath = tree.mkdir('occupied');

      await expect(writeCacheEntry(entryPath, 'a-digest')).rejects.toThrow(/occupied/);

      expect(fs.readdirSync(tree.dir)).toStrictEqual(['occupied']);
    });
  });

  describe(removeCacheEntry, () => {
    it('removes the entry that it names, leaving its neighbours alone', async ({ tree }) => {
      const ref = { tool: TOOL, scopeDir: tree.dir };
      const mine = resolveCacheEntryPath({ ...ref, slug: 'a', extension: '.hash' });
      const neighbour = resolveCacheEntryPath({ ...ref, slug: 'b', extension: '.hash' });
      await writeCacheEntry(mine, 'one');
      await writeCacheEntry(neighbour, 'two');

      await removeCacheEntry(mine);

      expect(fs.existsSync(mine)).toBe(false);
      expect(fs.existsSync(neighbour)).toBe(true);
    });

    it('given an entry that is not there, does nothing', async ({ tree }) => {
      await expect(removeCacheEntry(path.join(tree.dir, 'absent.hash'))).resolves.toBeUndefined();
    });
  });

  describe(removeCacheDir, () => {
    it('removes every entry in the tool’s cache', async ({ tree }) => {
      const ref = { tool: TOOL, scopeDir: tree.dir };
      await writeCacheEntry(resolveCacheEntryPath({ ...ref, slug: 'a', extension: '.hash' }), 'one');
      await writeCacheEntry(resolveCacheEntryPath({ ...ref, slug: 'b', extension: '.hash' }), 'two');

      await removeCacheDir(ref);

      expect(fs.existsSync(resolveCacheDir(ref))).toBe(false);
    });

    it('leaves another tool’s cache alone', async ({ tree }) => {
      const mine = { tool: TOOL, scopeDir: tree.dir };
      const theirs = { tool: 'other-tool', scopeDir: tree.dir };
      await writeCacheEntry(resolveCacheEntryPath({ ...mine, slug: 'a', extension: '.hash' }), 'one');
      const theirEntry = resolveCacheEntryPath({ ...theirs, slug: 'a', extension: '.hash' });
      await writeCacheEntry(theirEntry, 'two');

      await removeCacheDir(mine);

      expect(fs.existsSync(theirEntry)).toBe(true);
    });

    it('is a no-op when the tool does not have a cache', async ({ tree }) => {
      await expect(removeCacheDir({ tool: TOOL, scopeDir: tree.dir })).resolves.toBeUndefined();
    });
  });
});

// region | Helpers

/** Narrows a parsed entry to the shape that these tests store. */
function isHashEntry(value: unknown): value is { hash: string } {
  return typeof value === 'object' && value !== null && 'hash' in value && typeof value.hash === 'string';
}

// endregion | Helpers
