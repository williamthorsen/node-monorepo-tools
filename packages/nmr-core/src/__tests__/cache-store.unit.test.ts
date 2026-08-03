import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readCacheEntry,
  readJsonCacheEntry,
  removeCacheDir,
  resolveCacheDir,
  resolveCacheEntryPath,
  writeCacheEntry,
} from '../cache-store.ts';

const TOOL = 'test-tool';

describe('cache-store', () => {
  let root: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-cache-store-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe(resolveCacheDir, () => {
    it('places the cache under the scope directory’s own node_modules', () => {
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });

      expect(resolveCacheDir({ tool: TOOL, scopeDir: root })).toBe(path.join(root, 'node_modules', '.cache', TOOL));
    });

    it('hoists to the nearest ancestor holding a node_modules', () => {
      // A zero-dependency package has no `node_modules` of its own; materializing one to hold a cache would
      // leave a directory the package never asked for.
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      const packageDir = path.join(root, 'packages', 'leaf');
      fs.mkdirSync(packageDir, { recursive: true });

      expect(resolveCacheDir({ tool: TOOL, scopeDir: packageDir })).toBe(
        path.join(root, 'node_modules', '.cache', TOOL),
      );
    });

    it('falls back to the scope directory when no ancestor has a node_modules', () => {
      expect(resolveCacheDir({ tool: TOOL, scopeDir: root })).toBe(path.join(root, 'node_modules', '.cache', TOOL));
    });
  });

  describe(resolveCacheEntryPath, () => {
    it('is stable across calls for the same reference', () => {
      const ref = { tool: TOOL, scopeDir: root, slug: 'alpha', extension: '.json' };

      expect(resolveCacheEntryPath(ref)).toBe(resolveCacheEntryPath(ref));
    });

    it('names the entry with its slug and extension', () => {
      const entryPath = resolveCacheEntryPath({ tool: TOOL, scopeDir: root, slug: 'alpha', extension: '.hash' });

      expect(path.basename(entryPath)).toMatch(/^alpha-[\da-f]{8}\.hash$/);
    });

    it('separates scopes sharing one cache directory', () => {
      // Two packages hoisting to the same `node_modules` would otherwise write over each other's entries.
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      const a = path.join(root, 'packages', 'a');
      const b = path.join(root, 'packages', 'b');

      const pathA = resolveCacheEntryPath({ tool: TOOL, scopeDir: a, slug: 'pkg', extension: '.json' });
      const pathB = resolveCacheEntryPath({ tool: TOOL, scopeDir: b, slug: 'pkg', extension: '.json' });

      expect(pathA).not.toBe(pathB);
      expect(path.dirname(pathA)).toBe(path.dirname(pathB));
    });

    it('separates entries in one scope by their discriminators', () => {
      const base = { tool: TOOL, scopeDir: root, slug: 'entry', extension: '.json' };

      expect(resolveCacheEntryPath({ ...base, discriminators: ['check'] })).not.toBe(
        resolveCacheEntryPath({ ...base, discriminators: ['check:strict'] }),
      );
    });

    it('ignores an empty discriminator list, so adding the field cannot move an existing entry', () => {
      const base = { tool: TOOL, scopeDir: root, slug: 'entry', extension: '.hash' };

      expect(resolveCacheEntryPath({ ...base, discriminators: [] })).toBe(resolveCacheEntryPath(base));
    });
  });

  describe(readCacheEntry, () => {
    it('returns the entry’s text', async () => {
      const entryPath = path.join(root, 'entry.hash');
      fs.writeFileSync(entryPath, 'a-digest');

      await expect(readCacheEntry(entryPath)).resolves.toBe('a-digest');
    });

    it('reads a missing entry as a miss rather than an error', async () => {
      await expect(readCacheEntry(path.join(root, 'absent.hash'))).resolves.toBeUndefined();
    });

    it('reads a directory in the entry’s place as a miss', async () => {
      const entryPath = path.join(root, 'entry.hash');
      fs.mkdirSync(entryPath);

      await expect(readCacheEntry(entryPath)).resolves.toBeUndefined();
    });
  });

  describe(readJsonCacheEntry, () => {
    it('returns the parsed entry when it satisfies the guard', async () => {
      const entryPath = path.join(root, 'entry.json');
      fs.writeFileSync(entryPath, JSON.stringify({ hash: 'abc' }));

      await expect(readJsonCacheEntry(entryPath, isHashEntry)).resolves.toStrictEqual({ hash: 'abc' });
    });

    it('reads a missing entry as a miss', async () => {
      await expect(readJsonCacheEntry(path.join(root, 'absent.json'), isHashEntry)).resolves.toBeUndefined();
    });

    it('reads unparseable content as a miss', async () => {
      // A torn write from a store predating atomic renames, or a truncated disk, must not throw at the caller.
      const entryPath = path.join(root, 'entry.json');
      fs.writeFileSync(entryPath, '{"hash": "abc');

      await expect(readJsonCacheEntry(entryPath, isHashEntry)).resolves.toBeUndefined();
    });

    it('reads content of the wrong shape as a miss', async () => {
      // An entry written by an older format is content the caller cannot trust, so it may not reach the caller.
      const entryPath = path.join(root, 'entry.json');
      fs.writeFileSync(entryPath, JSON.stringify({ digest: 'abc' }));

      await expect(readJsonCacheEntry(entryPath, isHashEntry)).resolves.toBeUndefined();
    });
  });

  describe(writeCacheEntry, () => {
    it('creates the cache directory on the way', async () => {
      const entryPath = resolveCacheEntryPath({ tool: TOOL, scopeDir: root, slug: 'alpha', extension: '.hash' });

      await writeCacheEntry(entryPath, 'a-digest');

      expect(fs.readFileSync(entryPath, 'utf8')).toBe('a-digest');
    });

    it('replaces an existing entry', async () => {
      const entryPath = path.join(root, 'entry.hash');

      await writeCacheEntry(entryPath, 'first');
      await writeCacheEntry(entryPath, 'second');

      expect(fs.readFileSync(entryPath, 'utf8')).toBe('second');
    });

    it('leaves no temporary file behind', async () => {
      const entryPath = path.join(root, 'entry.hash');

      await writeCacheEntry(entryPath, 'a-digest');

      expect(fs.readdirSync(root)).toStrictEqual(['entry.hash']);
    });

    it('never exposes a half-written entry to a concurrent reader', async () => {
      // The write lands in a temporary file and is renamed into place, so a reader racing it sees the previous
      // entry or the new one. A plain `writeFile` would let a reader observe a truncated prefix.
      const entryPath = path.join(root, 'entry.hash');
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

    it('reports a write it could not complete, leaving no temporary file behind', async () => {
      // A cache that silently fails to record is a cache that never hits, with nothing to explain why.
      const entryPath = path.join(root, 'occupied');
      fs.mkdirSync(entryPath);

      await expect(writeCacheEntry(entryPath, 'a-digest')).rejects.toThrow(/occupied/);

      expect(fs.readdirSync(root)).toStrictEqual(['occupied']);
    });
  });

  describe(removeCacheDir, () => {
    it('removes every entry the tool holds', async () => {
      const ref = { tool: TOOL, scopeDir: root };
      await writeCacheEntry(resolveCacheEntryPath({ ...ref, slug: 'a', extension: '.hash' }), 'one');
      await writeCacheEntry(resolveCacheEntryPath({ ...ref, slug: 'b', extension: '.hash' }), 'two');

      await removeCacheDir(ref);

      expect(fs.existsSync(resolveCacheDir(ref))).toBe(false);
    });

    it('leaves another tool’s cache alone', async () => {
      const mine = { tool: TOOL, scopeDir: root };
      const theirs = { tool: 'other-tool', scopeDir: root };
      await writeCacheEntry(resolveCacheEntryPath({ ...mine, slug: 'a', extension: '.hash' }), 'one');
      const theirEntry = resolveCacheEntryPath({ ...theirs, slug: 'a', extension: '.hash' });
      await writeCacheEntry(theirEntry, 'two');

      await removeCacheDir(mine);

      expect(fs.existsSync(theirEntry)).toBe(true);
    });

    it('is a no-op when the tool has no cache', async () => {
      await expect(removeCacheDir({ tool: TOOL, scopeDir: root })).resolves.toBeUndefined();
    });
  });
});

// region | Helpers

/** Narrows a parsed entry to the shape these tests store. */
function isHashEntry(value: unknown): value is { hash: string } {
  return typeof value === 'object' && value !== null && 'hash' in value && typeof value.hash === 'string';
}

// endregion | Helpers
