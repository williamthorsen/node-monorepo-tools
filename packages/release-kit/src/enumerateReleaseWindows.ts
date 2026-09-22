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
  /** Oldest first. */
  commits: RawCommit[];
}

/** Inputs for {@link enumerateReleaseWindows}. */
export interface EnumerateReleaseWindowsOptions {
  /** Git pathspecs restricting the enumeration to commits that touch them. */
  paths?: readonly string[];
  /** Tag prefixes to match as a union; a matching tag name continues with a digit. */
  tagPrefixes: readonly string[];
  /** The version that the unreleased window reports, such as the tag that the release being prepared will write. */
  unreleasedTag: string;
  /** Returns the current time in epoch milliseconds; dates the unreleased window. */
  now?: () => number;
}

/**
 * Splits the history reachable from HEAD into release windows, newest first.
 *
 * The newest window is always the unreleased one, empty when HEAD sits on a tag. Released
 * windows follow in descending order, one per reachable tag matching a prefix. A tag that
 * HEAD cannot reach is dropped.
 *
 * A commit belongs to the oldest matching tag that contains it, and to the unreleased window
 * when no matching tag does. Containment is read from the ancestry graph rather than from a
 * position in a linear walk, because a branch commit authored before a tag and merged after it
 * is not in that tag's release.
 *
 * Three git invocations serve any number of tags: `git rev-list --topo-order --parents` for the
 * ancestry graph, `git for-each-ref` for the tag names with their creation dates and target
 * commits, and one path-filtered `git log` for the commits themselves.
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
    timestamp: Math.floor(now() / 1_000),
    commits: [],
  };

  const ancestry = readAncestry();
  if (ancestry.parentsByHash.size === 0) {
    return [unreleasedWindow];
  }

  const boundaries = readTagBoundaries(tagPrefixes, ancestry.positionByHash);
  const releasedWindows: ReleaseWindow[] = boundaries.map((boundary) => ({
    version: boundary.tag,
    timestamp: boundary.timestamp,
    commits: [],
  }));
  const windowIndexByHash = claimAncestors(boundaries, ancestry.parentsByHash);

  // Walk oldest first so that each window's commits accumulate in the order it reports them.
  for (const commit of readCommits(paths).toReversed()) {
    const windowIndex = windowIndexByHash.get(commit.hash);
    const window = windowIndex === undefined ? unreleasedWindow : (releasedWindows[windowIndex] ?? unreleasedWindow);
    window.commits.push(commit);
  }

  return [unreleasedWindow, ...releasedWindows.toReversed()];
}

// region | Helpers

/** The ancestry graph of the commits reachable from HEAD. */
interface Ancestry {
  /** Parent hashes per commit, which is what makes containment answerable. */
  parentsByHash: Map<string, string[]>;
  /** Each commit's line in the topological walk; a larger position is older. */
  positionByHash: Map<string, number>;
}

/** A tag, the commit it points at, and the date under which its release shipped. */
interface TagBoundary {
  /** The commit the tag points at, dereferenced for an annotated tag. */
  hash: string;
  /** The tagged commit's position in the topological walk. */
  position: number;
  tag: string;
  /** Unix seconds, from the tag's creation date. */
  timestamp: number;
}

/**
 * Assigns each reachable commit to the boundary whose release first contained it, as an index
 * into `boundaries`. A commit no boundary contains is absent from the result.
 *
 * `boundaries` runs oldest release first, so each boundary claims only what the releases before
 * it left unclaimed. A topological walk puts an ancestor after its descendants, which is what
 * lets the caller order the boundaries without a second traversal.
 */
function claimAncestors(
  boundaries: readonly TagBoundary[],
  parentsByHash: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const windowIndexByHash = new Map<string, number>();
  for (const [windowIndex, boundary] of boundaries.entries()) {
    const pending = [boundary.hash];
    while (pending.length > 0) {
      const hash = pending.pop();
      if (hash === undefined || windowIndexByHash.has(hash)) {
        continue;
      }
      windowIndexByHash.set(hash, windowIndex);
      pending.push(...(parentsByHash.get(hash) ?? []));
    }
  }
  return windowIndexByHash;
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
 * Reads the ancestry of every commit reachable from HEAD.
 *
 * `--ignore-missing` makes an unborn HEAD yield an empty graph rather than the exit code that
 * git also uses outside a repository, so the empty-history case stays distinguishable from a
 * genuine failure.
 */
function readAncestry(): Ancestry {
  const args = ['rev-list', '--topo-order', '--parents', '--ignore-missing', 'HEAD'];
  const output = runGit(args, `'git rev-list' for HEAD`);

  const ancestry: Ancestry = { parentsByHash: new Map(), positionByHash: new Map() };
  for (const [position, line] of output.split('\n').entries()) {
    const [hash, ...parents] = line.split(' ');
    if (hash === undefined || hash === '') {
      continue;
    }
    ancestry.parentsByHash.set(hash, parents);
    ancestry.positionByHash.set(hash, position);
  }
  return ancestry;
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
 * Reads the tags matching a prefix and reachable from HEAD, oldest release first.
 *
 * A tag's `creatordate` resolves to the tagger date for the annotated tags `createTags.ts`
 * writes, and to the commit date for a lightweight one.
 */
function readTagBoundaries(tagPrefixes: readonly string[], positionByHash: ReadonlyMap<string, number>): TagBoundary[] {
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
    const hash = dereferencedName || objectName;
    const position = positionByHash.get(hash);
    if (position !== undefined) {
      boundaries.push({ hash, position, tag, timestamp: Number(creatorDate) });
    }
  }

  return boundaries.toSorted((left, right) => right.position - left.position);
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
