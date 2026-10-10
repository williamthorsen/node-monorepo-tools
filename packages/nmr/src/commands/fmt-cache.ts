import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import { describeError } from '@williamthorsen/toolbelt.errors';

import { NO_CACHE_ENV_VAR } from '../check-cache.ts';
import { isObject } from '../helpers/type-guards.ts';

/** The directory, relative to the repository root, holding one Prettier cache file per scope. */
export const FMT_CACHE_DIRECTORY = path.join('node_modules', '.cache', 'prettier', 'nmr-fmt');

/** Lockfiles fingerprinted into the cache file's name, in the fixed order in which they are hashed. */
const LOCKFILE_NAMES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];

/** Stands in for the lockfile fingerprint in a repository whose root does not contain any lockfile. */
const NO_LOCKFILE_MARKER = 'nolock';

const HASH_LENGTH = 16;

const CACHE_FILE_PATTERN = /^([0-9a-f]{16})\.([0-9a-f]{16}|nolock)\.json$/;

export interface PrepareFmtCacheOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  repositoryRoot: string;
  shouldBypassCache: boolean;
}

export type PrepareFmtCacheResult =
  { kind: 'cached'; location: string } | { kind: 'uncached' } | { kind: 'failed'; reason: string };

/**
 * Resolves the Prettier cache file for this scope, after pruning cache files keyed to an outdated lockfile and
 * discarding a corrupt one, or reports why the run goes uncached.
 *
 * The file name combines a hash of the scope with a fingerprint of the repository's lockfiles. Prettier keys
 * entries by path relative to its working directory, so each scope needs a file of its own; Prettier's own key
 * covers its version and the resolved options but not plugin code, which the lockfile fingerprint covers.
 */
export function prepareFmtCache(options: PrepareFmtCacheOptions): PrepareFmtCacheResult {
  const { cwd, env, repositoryRoot, shouldBypassCache } = options;
  if (shouldBypassCache || env[NO_CACHE_ENV_VAR] === '1') return { kind: 'uncached' };

  try {
    // Creating `node_modules` in a repository that was never installed would leave an untracked directory behind.
    if (statSync(path.join(repositoryRoot, 'node_modules'), { throwIfNoEntry: false })?.isDirectory() !== true) {
      return { kind: 'uncached' };
    }

    const cacheDirectory = path.join(repositoryRoot, FMT_CACHE_DIRECTORY);
    mkdirSync(cacheDirectory, { recursive: true });

    const lockfileHash = hashLockfiles(repositoryRoot);
    pruneOutdatedCacheFiles(cacheDirectory, lockfileHash);

    // Resolve symlinks, since git reports the repository root with its symlinks resolved.
    const scope = path.relative(repositoryRoot, realpathSync(cwd)).split(path.sep).join('/');
    const location = path.join(cacheDirectory, `${hash(scope)}.${lockfileHash}.json`);
    if (isCorruptCacheFile(location)) rmSync(location, { force: true });

    return { kind: 'cached', location };
  } catch (error) {
    return { kind: 'failed', reason: describeError(error) };
  }
}

// region | Helpers

/** Returns the first `HASH_LENGTH` hex characters of the SHA-256 of `input`. */
function hash(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex').slice(0, HASH_LENGTH);
}

/** Fingerprints the name and content of every lockfile at the repository root, or returns the no-lockfile marker. */
function hashLockfiles(repositoryRoot: string): string {
  const digest = createHash('sha256');
  let hasLockfile = false;

  for (const name of LOCKFILE_NAMES) {
    const lockfilePath = path.join(repositoryRoot, name);
    if (statSync(lockfilePath, { throwIfNoEntry: false })?.isFile() !== true) continue;
    // Hash the name with a separator, so that moving bytes between two lockfiles changes the fingerprint.
    digest.update(`${name}\0`).update(readFileSync(lockfilePath)).update('\0');
    hasLockfile = true;
  }

  return hasLockfile ? digest.digest('hex').slice(0, HASH_LENGTH) : NO_LOCKFILE_MARKER;
}

/**
 * Reports whether a cache file exists that Prettier would reject. Prettier exits 1 on a `--cache-location` that
 * is not valid JSON, the same status that it returns for an unformatted file.
 */
function isCorruptCacheFile(location: string): boolean {
  let content: string;
  try {
    content = readFileSync(location, 'utf8');
  } catch {
    return false;
  }

  try {
    return !isObject(JSON.parse(content));
  } catch {
    return true;
  }
}

/** Deletes every cache file whose lockfile fingerprint is not `lockfileHash`, leaving unrecognized files alone. */
function pruneOutdatedCacheFiles(cacheDirectory: string, lockfileHash: string): void {
  for (const name of readdirSync(cacheDirectory)) {
    const match = CACHE_FILE_PATTERN.exec(name);
    if (match !== null && match[2] !== lockfileHash) {
      rmSync(path.join(cacheDirectory, name), { force: true });
    }
  }
}

// endregion | Helpers
