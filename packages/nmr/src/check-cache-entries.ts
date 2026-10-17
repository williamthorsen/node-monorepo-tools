import path from 'node:path';
import type { Writable } from 'node:stream';

import {
  type CacheEntryRef,
  readCacheEntry,
  readJsonCacheEntry,
  removeCacheDir,
  removeCacheEntry,
  resolveCacheEntryPath,
  writeCacheEntry,
} from '@williamthorsen/nmr-core';
import { describeError } from '@williamthorsen/toolbelt.errors';

import { writeDebugNote } from './check-cache.ts';
import { isObject, isStringRecord } from './helpers/type-guards.ts';

/** A recorded pass: what ran, on which tree, and how long it took. */
export interface CheckCacheEntry {
  /** The full cache key under which the pass was recorded; a hit is this key matching the key computed now. */
  key: string;
  treeHash: string;
  headSha: string;
  commandString: string;
  nmrVersion: string;
  nodeVersion: string;
  durationMs: number;
  /** ISO-8601 instant the pass completed. */
  recordedAt: string;
  /**
   * The build digest that each covered package's output had when the pass was recorded. Build output is
   * git-ignored, so the tree hash cannot describe it; comparing these separates output built from this tree from
   * output that another tree left behind.
   */
  buildDigests: Record<string, string>;
  /** What a skip replays in place of the run that it recalls, absent on a pass that retained nothing. */
  retention?: Retention;
}

/** What locates one command's recorded pass at one scope, and the transcript beside it. */
export interface EntryRef {
  anchorDir: string;
  command: string;
  monorepoRoot: string;
}

/** One command's excerpt, attributed to the scope and the command that produced it. */
export interface ReplayLine {
  command: string;
  excerpt: string;
  scope: string;
}

/**
 * What a recalled pass replays, the key certifying the excerpts describe this environment's output, and the
 * run that last vouched for them.
 *
 * A list rather than one excerpt: a composite's entry contains its constituents' lines, and a nested one's are
 * spliced into its parent's, after which the attribution cannot be re-derived from the entry that contains them.
 *
 * The witness admits a constituent's line into the assembly that its parent records: a run writes it when it
 * records an excerpt, and restamps it when it recalls one and replays it.
 */
export interface Retention {
  key: string;
  replay: ReplayLine[];
  runId: string;
}

/** The tool whose cache directory stores check results. */
const CACHE_TOOL = 'nmr-check';

/** Characters that a command name may contribute to a file name; every other character becomes a hyphen. */
const UNSAFE_SLUG_CHARACTERS = /[^\w.-]+/g;

/**
 * Restamps a recalled entry's retention with the run that is replaying it, so that an excerpt certified by this
 * run can join the assembly recorded by a composite above it.
 *
 * A recall certifies as surely as a recording does. Because the pass key matched, the excerpt describes this
 * tree; because the caller calls this only when the retention key matched too, the excerpt also describes this
 * presentation environment. Everything else the entry records stands -- the instant and the duration belong to
 * the run that earned the pass, and a recall must not make it read as later or longer than it was.
 *
 * A cache that cannot be written is not worth failing a green run over: `certifyRetention` reports that failure
 * in the debug note.
 */
export async function certifyRetention(options: {
  anchorDir: string;
  command: string;
  entry: CheckCacheEntry;
  env: NodeJS.ProcessEnv;
  monorepoRoot: string;
  runId: string;
  stderr: Writable;
}): Promise<void> {
  const { entry, runId } = options;
  if (entry.retention === undefined || entry.retention.runId === runId) {
    return;
  }

  try {
    await writeCheckCacheEntry({
      anchorDir: options.anchorDir,
      command: options.command,
      monorepoRoot: options.monorepoRoot,
      entry: { ...entry, retention: { ...entry.retention, runId } },
    });
  } catch (error: unknown) {
    writeDebugNote(`could not certify ${options.command}: ${describeError(error)}`, options.env, options.stderr);
  }
}

/**
 * Reads the entry recorded for one command at one scope, or `undefined` when there is none to trust.
 *
 * Retention is vouched for separately from the pass that contains it: an excerpt of a shape that this function
 * cannot read is dropped, leaving a pass that skips cleanly and reports its verdict alone.
 */
export async function readCheckCacheEntry(options: {
  anchorDir: string;
  command: string;
  monorepoRoot: string;
}): Promise<CheckCacheEntry | undefined> {
  const parsedEntry = await readJsonCacheEntry(resolveEntryPath(options), isParsedCheckCacheEntry);
  if (parsedEntry === undefined) {
    return undefined;
  }

  const { retention, ...pass } = parsedEntry;

  return isRetention(retention) ? { ...pass, retention } : pass;
}

/**
 * Reads the whole output that one recorded pass retained, or `undefined` when it retained none.
 *
 * Held to nothing on its own: the entry beside it says which tree the bytes describe, and a caller
 * that has not matched the entry's key is reading a transcript of some other tree.
 */
export async function readTranscript(ref: EntryRef): Promise<string | undefined> {
  return readCacheEntry(resolveEntryPath(ref, '.log'));
}

/**
 * Makes the transcript beside one entry be exactly what this pass retained, removing what an earlier pass
 * left when this one retained nothing.
 *
 * A composite retains nothing of its own, so without the removal a leaf's transcript would remain beside an
 * entry that never produced it, and `--log` would date another run's bytes by this one's instant.
 */
export async function recordTranscript(ref: EntryRef, transcript: string | undefined): Promise<void> {
  const entryPath = resolveEntryPath(ref, '.log');

  if (transcript === undefined) {
    await removeCacheEntry(entryPath);
    return;
  }

  await writeCacheEntry(entryPath, transcript);
}

/** Removes every recorded pass for a monorepo, or for a standalone package outside one. */
export async function removeCheckCache(scopeDir: string): Promise<void> {
  await removeCacheDir({ tool: CACHE_TOOL, scopeDir });
}

/** Records a pass, replacing whatever this command last recorded at this scope. */
export async function writeCheckCacheEntry(options: {
  anchorDir: string;
  command: string;
  entry: CheckCacheEntry;
  monorepoRoot: string;
}): Promise<void> {
  await writeCacheEntry(resolveEntryPath(options), JSON.stringify(options.entry, undefined, 2));
}

// region | Helpers

/** A recorded pass as it parses, before the retention beside it has been vouched for. */
type ParsedCheckCacheEntry = Omit<CheckCacheEntry, 'retention'> & { retention?: unknown };

/**
 * Narrows a parsed entry, so that one written by an older format reads as a miss rather than as a pass. The
 * timestamp has to parse and the duration has to be finite, because a recalled pass uses both in its verdict: an
 * entry that would render as `passed NaNs ago` is one that a reader cannot act on.
 *
 * The retention that an entry may contain is left unread here, so that what a skip replays cannot decide whether the
 * pass beneath it stands.
 */
function isParsedCheckCacheEntry(value: unknown): value is ParsedCheckCacheEntry {
  if (!isObject(value)) {
    return false;
  }

  const stringFields = ['key', 'treeHash', 'headSha', 'commandString', 'nmrVersion', 'nodeVersion', 'recordedAt'];
  if (stringFields.some((field) => typeof value[field] !== 'string')) {
    return false;
  }

  return (
    typeof value['durationMs'] === 'number' &&
    Number.isFinite(value['durationMs']) &&
    !Number.isNaN(Date.parse(String(value['recordedAt']))) &&
    isStringRecord(value['buildDigests'])
  );
}

/** Narrows a recorded replay line, whose three fields a rendered line uses in full. */
function isReplayLine(value: unknown): value is ReplayLine {
  return (
    isObject(value) &&
    typeof value['command'] === 'string' &&
    typeof value['excerpt'] === 'string' &&
    typeof value['scope'] === 'string'
  );
}

/** Narrows recorded retention, so that an entry claiming an excerpt that it cannot produce reads as a miss. */
function isRetention(value: unknown): value is Retention {
  return (
    isObject(value) &&
    typeof value['key'] === 'string' &&
    typeof value['runId'] === 'string' &&
    Array.isArray(value['replay']) &&
    value['replay'].every((line) => isReplayLine(line))
  );
}

/**
 * Locates one command's entry, or the transcript beside it. Because every entry in a monorepo is stored in one
 * directory, keyed by the scope and the command, a single removal clears the whole table however many packages
 * recorded into it. The pair shares one digest, differing only in extension.
 */
function resolveEntryPath(options: EntryRef, extension: '.json' | '.log' = '.json'): string {
  const anchorDir = path.resolve(options.anchorDir);
  const ref: CacheEntryRef = {
    tool: CACHE_TOOL,
    scopeDir: options.monorepoRoot,
    slug: `${path.basename(anchorDir)}-${options.command.replaceAll(UNSAFE_SLUG_CHARACTERS, '-')}`,
    extension,
    discriminators: [anchorDir, options.command],
  };

  return resolveCacheEntryPath(ref);
}

// endregion | Helpers
