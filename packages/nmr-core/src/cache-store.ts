import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Names the cache directory a tool's entries live in: `{home}/node_modules/.cache/{tool}/`. */
export interface CacheDirRef {
  /** The tool the cache belongs to, e.g. `nmr-compile`. Becomes the directory name. */
  tool: string;
  /** The directory the cache serves; its nearest `node_modules` ancestor hosts the cache. */
  scopeDir: string;
}

/** Locates a single entry within a tool's cache directory. */
export interface CacheEntryRef extends CacheDirRef {
  /** Readable filename prefix, e.g. the package name. */
  slug: string;
  /** Filename extension, including the leading dot. */
  extension: string;
  /**
   * Strings folded into the filename digest alongside the absolute scope directory, so that one scope can hold
   * several entries. Two refs differing only in `slug` would collide were the slug all that separated them.
   */
  discriminators?: string[];
}

/** The digest length that separates entries sharing a hoisted `node_modules` while keeping the name readable. */
const DIGEST_LENGTH = 8;

/**
 * Reads an entry's raw text, or `undefined` when it is absent or unreadable. A cache that cannot be read is a
 * miss, never an error: the caller's fallback is to do the work again, which is always correct.
 */
export async function readCacheEntry(entryPath: string): Promise<string | undefined> {
  try {
    return await readFile(entryPath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Reads a JSON entry and narrows it with `isValidEntry`, returning `undefined` when the entry is missing,
 * unparseable, or of the wrong shape. Content written by an older format therefore reads as a miss rather than
 * reaching the caller as a value it cannot trust.
 */
export async function readJsonCacheEntry<T>(
  entryPath: string,
  isValidEntry: (value: unknown) => value is T,
): Promise<T | undefined> {
  const raw = await readCacheEntry(entryPath);
  if (raw === undefined) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return isValidEntry(parsed) ? parsed : undefined;
}

/** Removes a tool's entire cache directory. Idempotent: an absent directory is a silent no-op. */
export async function removeCacheDir(ref: CacheDirRef): Promise<void> {
  await rm(resolveCacheDir(ref), { force: true, recursive: true });
}

/**
 * Resolves the absolute path of a tool's cache directory. The conventional `node_modules/.cache/{tool}/` home is
 * git-ignored and outside any `files` convention, so an entry never reaches a published tarball. The home is the
 * nearest enclosing directory that already has a `node_modules`: the scope's own when it has one, otherwise a
 * hoisted ancestor, such as the workspace root for a zero-dependency package. No `node_modules` is ever
 * materialized solely to hold the cache.
 */
export function resolveCacheDir(ref: CacheDirRef): string {
  const absoluteScopeDir = path.resolve(ref.scopeDir);
  const home = findNearestNodeModulesHost(absoluteScopeDir) ?? absoluteScopeDir;
  return path.join(home, 'node_modules', '.cache', ref.tool);
}

/**
 * Resolves the absolute path of a single cache entry. The file name folds a digest of the absolute scope
 * directory (and any discriminators) into a readable base name, so scopes sharing a hoisted `node_modules`
 * never collide while the path stays stable across runs for the same scope.
 */
export function resolveCacheEntryPath(ref: CacheEntryRef): string {
  const absoluteScopeDir = path.resolve(ref.scopeDir);
  const digest = createHash('sha256')
    .update([absoluteScopeDir, ...(ref.discriminators ?? [])].join('\0'))
    .digest('hex')
    .slice(0, DIGEST_LENGTH);

  return path.join(resolveCacheDir(ref), `${ref.slug}-${digest}${ref.extension}`);
}

/**
 * Writes an entry, creating the cache directory as needed. The write lands in a uniquely named temporary file
 * and is renamed into place, so a concurrent reader sees either the previous entry or the new one and never a
 * half-written file. Throws when the write cannot be completed; a caller for whom a failed cache write is not
 * worth failing over catches it.
 */
export async function writeCacheEntry(entryPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(entryPath), { recursive: true });

  const temporaryPath = `${entryPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, entryPath);
  } catch (error: unknown) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may never have been created, so its removal is best-effort: the write's own
      // failure is what the caller needs to hear about.
    }
    throw error;
  }
}

// region | Helpers

/**
 * Walks up from `startDir` (inclusive) to the filesystem root, returning the first directory that contains a
 * `node_modules` entry, or `undefined` when none does.
 */
function findNearestNodeModulesHost(startDir: string): string | undefined {
  let current = startDir;
  let parent = path.dirname(current);
  while (!existsSync(path.join(current, 'node_modules'))) {
    if (parent === current) {
      return undefined;
    }
    current = parent;
    parent = path.dirname(current);
  }
  return current;
}

// endregion | Helpers
