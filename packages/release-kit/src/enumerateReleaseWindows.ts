import { execFileSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT } from '@williamthorsen/nmr-core';
import { chainError } from '@williamthorsen/toolbelt.errors/candidate';

/**
 * Unit separator (U+001F) delimiting the fields of one git output record.
 *
 * Node.js v24+ rejects null bytes in child-process arguments, so this ASCII control
 * character stands in. Git produces neither control character in a commit message.
 */
const FIELD_SEPARATOR = '\u{1F}';

/** Record separator (U+001E) delimiting commit records, whose bodies contain newlines. */
const RECORD_SEPARATOR = '\u{1E}';

/** A commit as git records it, before any parsing or filtering. */
export interface RawCommit {
  /** The full 40-character hash, which `changelogOverrides` keys on. */
  hash: string;
  /** The first line, with a wrapped subject folded onto one line by git. */
  subject: string;
  /** The message after its first blank line, empty when the commit carries no body. */
  body: string;
  /** The raw commit message, subject and body together. */
  message: string;
}

/** The commits one release contains, with the version and date under which they shipped. */
export interface ReleaseWindow {
  /** The tag name for a released window, the caller's unreleased-tag name for the newest one. */
  version: string;
  /** Unix seconds: the tag's creation date for a released window, the clock for the unreleased one. */
  timestamp: number;
  /** Oldest first, matching the changelog template's `sort_commits = "oldest"`. */
  commits: RawCommit[];
}

/** Inputs for {@link enumerateReleaseWindows}. */
export interface EnumerateReleaseWindowsOptions {
  /** Glob patterns restricting the enumeration to commits that touch them. */
  paths?: readonly string[];
  /** Tag prefixes to match as a union; a matching tag name continues with a digit. */
  tagPrefixes: readonly string[];
  /** The version the unreleased window reports, as git-cliff's `--tag` supplied it. */
  unreleasedTag: string;
  /** Returns the current time in epoch milliseconds; dates the unreleased window. */
  now?: () => number;
}

/**
 * Splits the history reachable from HEAD into release windows, newest first.
 *
 * The newest window is always the unreleased one, empty when HEAD sits on a tag. Released
 * windows follow in descending order, one per reachable tag matching a prefix. A tag that
 * HEAD cannot reach is dropped, as git-cliff's revwalk dropped it.
 *
 * Three git invocations serve any number of tags: `git rev-list` for an ordinal index of the
 * history, `git for-each-ref` for the tag names with their creation dates and target commits,
 * and one path-filtered `git log` for the commits themselves.
 *
 * @throws If `tagPrefixes` is empty, or if any git invocation fails.
 */
export function enumerateReleaseWindows(options: EnumerateReleaseWindowsOptions): ReleaseWindow[] {
  const { now = Date.now, paths, tagPrefixes, unreleasedTag } = options;
  if (tagPrefixes.length === 0) {
    throw new Error('enumerateReleaseWindows: tagPrefixes must contain at least one entry');
  }

  const unreleasedWindow: ReleaseWindow = {
    version: unreleasedTag,
    timestamp: Math.floor(now() / 1000),
    commits: [],
  };

  const ordinalsByHash = readCommitOrdinals();
  if (ordinalsByHash.size === 0) {
    return [unreleasedWindow];
  }

  // Ascending ordinal, so the first boundary at or above a commit's ordinal is the release
  // that first contained it.
  const boundaries = readTagBoundaries(tagPrefixes, ordinalsByHash);
  const releasedWindows: ReleaseWindow[] = boundaries.map((boundary) => ({
    version: boundary.tag,
    timestamp: boundary.timestamp,
    commits: [],
  }));

  // Walk oldest first so that each window's commits accumulate in the order it reports them.
  for (const commit of readCommits(paths).reverse()) {
    // Both lists come from the same walk, so every logged commit has an ordinal.
    const ordinal = ordinalsByHash.get(commit.hash) ?? Number.POSITIVE_INFINITY;
    findWindow(boundaries, releasedWindows, unreleasedWindow, ordinal).commits.push(commit);
  }

  return [unreleasedWindow, ...releasedWindows.reverse()];
}

// region | Helpers

/** A tag's position in the history, with the date under which its release shipped. */
interface TagBoundary {
  /** Position of the tagged commit in the oldest-first ordinal index. */
  ordinal: number;
  tag: string;
  /** Unix seconds, from the tag's creation date. */
  timestamp: number;
}

/**
 * Returns the window that first contained a commit at the given ordinal: the one whose tag
 * is the lowest boundary at or above it, or the unreleased window when no boundary is.
 *
 * `releasedWindows` runs parallel to `boundaries`, both ascending by ordinal.
 */
function findWindow(
  boundaries: readonly TagBoundary[],
  releasedWindows: readonly ReleaseWindow[],
  unreleasedWindow: ReleaseWindow,
  ordinal: number,
): ReleaseWindow {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const boundary = boundaries[middle];
    if (boundary !== undefined && boundary.ordinal < ordinal) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return releasedWindows[low] ?? unreleasedWindow;
}

/** Checks whether a tag name starts with one of the prefixes and continues with a digit. */
function matchesTagPrefix(tagName: string, tagPrefixes: readonly string[]): boolean {
  return tagPrefixes.some((prefix) => tagName.startsWith(prefix) && /^\d/.test(tagName.slice(prefix.length)));
}

/** Splits one `git log` record into a commit, or returns undefined when the record is blank. */
function parseCommitRecord(record: string): RawCommit | undefined {
  // `--pretty=format:` joins records with a newline, which precedes every record but the first.
  const [hash, subject, message] = record.replace(/^\n+/, '').split(FIELD_SEPARATOR);
  if (hash === undefined || subject === undefined || message === undefined || hash === '') {
    return undefined;
  }
  const trimmedMessage = message.replace(/\s+$/, '');
  const bodyStart = trimmedMessage.indexOf('\n\n');
  const body = bodyStart === -1 ? '' : trimmedMessage.slice(bodyStart + 2);

  return { hash, subject, body, message: trimmedMessage };
}

/**
 * Indexes every commit reachable from HEAD by its position in an oldest-first walk.
 *
 * `--ignore-missing` makes an unborn HEAD yield an empty index rather than the exit code
 * that git also uses outside a repository, so the empty-history case stays distinguishable
 * from a genuine failure.
 */
function readCommitOrdinals(): Map<string, number> {
  const output = runGit(['rev-list', '--ignore-missing', 'HEAD'], `'git rev-list' for HEAD`);

  const ordinalsByHash = new Map<string, number>();
  const hashes = output.split('\n').reverse();
  for (const [ordinal, hash] of hashes.entries()) {
    if (hash !== '') {
      ordinalsByHash.set(hash, ordinal);
    }
  }
  return ordinalsByHash;
}

/**
 * Reads every commit reachable from HEAD that touches one of the paths, newest first.
 *
 * `git log` applies its default history simplification, which is what the bump path has
 * always read.
 */
function readCommits(paths: readonly string[] | undefined): RawCommit[] {
  const format = `%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%B${RECORD_SEPARATOR}`;
  const args = ['log', 'HEAD', `--pretty=format:${format}`];
  if (paths !== undefined && paths.length > 0) {
    args.push('--', ...paths);
  }

  const output = runGit(args, `'git log' for HEAD`);

  const commits: RawCommit[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    const commit = parseCommitRecord(record);
    if (commit !== undefined) {
      commits.push(commit);
    }
  }
  return commits;
}

/**
 * Reads the tags matching a prefix and reachable from HEAD, ascending by ordinal.
 *
 * A tag's `creatordate` resolves to the tagger date for the annotated tags `createTags.ts`
 * writes, and to the commit date for a lightweight one.
 */
function readTagBoundaries(tagPrefixes: readonly string[], ordinalsByHash: ReadonlyMap<string, number>): TagBoundary[] {
  const fields = ['%(refname:strip=2)', '%(creatordate:unix)', '%(objectname)', '%(*objectname)'];
  const args = ['for-each-ref', `--format=${fields.join('%1f')}`, 'refs/tags'];

  const output = runGit(args, `'git for-each-ref' for refs/tags`);

  const boundaries: TagBoundary[] = [];
  for (const line of output.split('\n')) {
    const [tag, creatorDate, objectName, dereferencedName] = line.split(FIELD_SEPARATOR);
    if (tag === undefined || creatorDate === undefined || objectName === undefined) {
      continue;
    }
    if (!matchesTagPrefix(tag, tagPrefixes)) {
      continue;
    }
    // An annotated tag names its commit in the dereferenced field; a lightweight tag is the commit.
    const ordinal = ordinalsByHash.get(dereferencedName || objectName);
    if (ordinal !== undefined) {
      boundaries.push({ ordinal, tag, timestamp: Number(creatorDate) });
    }
  }

  return boundaries.sort((left, right) => left.ordinal - right.ordinal);
}

/** Runs a git command and returns its trimmed stdout, chaining any failure to `description`. */
function runGit(args: readonly string[], description: string): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_LIMIT,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: unknown) {
    throw chainError(`Failed to run ${description}`, error);
  }
}

// endregion | Helpers
