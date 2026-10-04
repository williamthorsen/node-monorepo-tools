import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { findDirectoryChainMatch } from '@williamthorsen/toolbelt.filesystem';
import { writeAtomic } from '@williamthorsen/toolbelt.filesystem/candidate';

/** Names the cache directory that contains a tool's entries: `{home}/node_modules/.cache/{tool}/`. */
export interface CacheDirRef {
  /** The tool to which the cache belongs, e.g. `nmr-compile`. Becomes the directory name. */
  tool: string;
  /** The directory that the cache serves; its nearest `node_modules` ancestor contains the cache. */
  scopeDir: string;
}

/** Locates a single entry within a tool's cache directory. */
export interface CacheEntryRef extends CacheDirRef {
  /** Readable filename prefix, e.g. the package name. */
  slug: string;
  /** Filename extension, including the leading dot. */
  extension: string;
  /**
   * Strings folded into the filename digest alongside the absolute scope directory, so that one scope can have
   * several entries.
   */
  discriminators?: string[];
}

/** The digest length that separates entries sharing a hoisted `node_modules` while keeping the name readable. */
const DIGEST_LENGTH = 8;

/**
 * Reads an entry's raw text, or `undefined` when it is absent or unreadable. A cache that cannot be read is a
 * miss, never an error: The caller's fallback is to do the work again, which is always correct.
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
 * unparseable, or of the wrong shape. Content written in an older format therefore reads as a miss rather than
 * being returned to the caller as a value that it cannot trust.
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

/** Removes a tool's entire cache directory. Idempotent: An absent directory is a silent no-op. */
export async function removeCacheDir(ref: CacheDirRef): Promise<void> {
  await rm(resolveCacheDir(ref), { force: true, recursive: true });
}

/** Removes a single entry. Idempotent: An absent entry is a silent no-op, as is an absent cache directory. */
export async function removeCacheEntry(entryPath: string): Promise<void> {
  await rm(entryPath, { force: true });
}

/**
 * Resolves the absolute path of a tool's cache directory. The conventional `node_modules/.cache/{tool}/` home is
 * git-ignored and outside any `files` convention, so an entry is never included in a published tarball. The home
 * is the nearest enclosing directory that already has a `node_modules`: the scope's own when it has one, otherwise
 * a hoisted ancestor, such as the workspace root for a zero-dependency package. The function never materializes a
 * `node_modules` solely to store the cache.
 */
export function resolveCacheDir(ref: CacheDirRef): string {
  const absoluteScopeDir = path.resolve(ref.scopeDir);
  const home = findDirectoryChainMatch(absoluteScopeDir, ['node_modules'])?.dir ?? absoluteScopeDir;
  return path.join(home, 'node_modules', '.cache', ref.tool);
}

/**
 * Resolves the absolute path of a single cache entry. The function folds a digest of the absolute scope directory
 * (and any discriminators) into a readable base name, so scopes sharing a hoisted `node_modules` never collide
 * while the path stays stable across runs for the same scope.
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
 * Writes an entry atomically, creating the cache directory as needed, so that a concurrent reader sees either the
 * previous entry or the new one and never a half-written file. Throws when the write cannot be completed; a caller
 * for whom a failed cache write is not worth failing over catches it.
 */
export async function writeCacheEntry(entryPath: string, content: string): Promise<void> {
  await writeAtomic(entryPath, content);
}
