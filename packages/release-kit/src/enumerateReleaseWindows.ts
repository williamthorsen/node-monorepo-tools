import type { Git, RawCommit } from './git.ts';
import { matchesTagPrefix } from './matchesTagPrefix.ts';
import { chainUserError } from './user-error-chaining.ts';

/** The commits that one release contains, with the version and date under which they were released. */
export interface ReleaseWindow {
  /** The tag name for a released window, the caller's unreleased-tag name for the newest one. */
  version: string;
  /** Unix seconds: the tag's creation date for a released window, the clock for the unreleased one. */
  timestampSec: number;
  /** Oldest first. */
  commits: RawCommit[];
}

/** Inputs for {@link enumerateReleaseWindows}. */
export interface EnumerateReleaseWindowsOptions {
  /** The git through which the history is read. */
  git: Git;
  /** Git pathspecs restricting the enumeration to commits that touch them. */
  paths?: readonly string[];
  /** Tag prefixes to match as a union; a matching tag name continues with a complete SemVer version. */
  tagPrefixes: readonly string[];
  /** The version that the unreleased window reports, such as the tag that the release being prepared will write. */
  unreleasedTag: string;
  /** Returns the current time in epoch milliseconds; dates the unreleased window. */
  now?: () => number;
}

/**
 * Splits the history reachable from HEAD into release windows, newest first.
 *
 * The newest window is always the unreleased one, empty when HEAD is at a matching tag. Released
 * windows follow in descending order, one per reachable tag matching a prefix. A tag that
 * HEAD cannot reach is dropped.
 *
 * A commit belongs to the oldest matching tag that contains it, and to the unreleased window
 * when it is not contained by any matching tag. Containment is read from the ancestry graph
 * rather than from a position in a linear walk, because a branch commit authored before a tag
 * and merged after it is not in that tag's release.
 *
 * Three git invocations serve any number of tags: `git rev-list --topo-order --parents` for the
 * ancestry graph, `git for-each-ref` for the tag names with their creation dates and target
 * commits, and one path-filtered `git log` for the commits themselves.
 *
 * Throws if `tagPrefixes` is empty, or if any git invocation fails.
 */
export function enumerateReleaseWindows(options: EnumerateReleaseWindowsOptions): ReleaseWindow[] {
  const { git, now = Date.now, paths, tagPrefixes, unreleasedTag } = options;
  if (tagPrefixes.length === 0) {
    throw new Error('enumerateReleaseWindows: tagPrefixes must contain at least one entry');
  }

  const unreleasedWindow: ReleaseWindow = {
    version: unreleasedTag,
    timestampSec: Math.floor(now() / 1000),
    commits: [],
  };

  const ancestry = readAncestry(git);
  if (ancestry.parentsByHash.size === 0) {
    return [unreleasedWindow];
  }

  const boundaries = readTagBoundaries(git, tagPrefixes, ancestry.positionByHash);
  const releasedWindows: ReleaseWindow[] = boundaries.map((boundary) => ({
    version: boundary.tag,
    timestampSec: boundary.timestampSec,
    commits: [],
  }));
  const windowIndexByHash = claimAncestors(boundaries, ancestry.parentsByHash);

  // Walk oldest first so that each window's commits accumulate in the order it reports them.
  for (const commit of readCommits(git, paths).toReversed()) {
    const windowIndex = windowIndexByHash.get(commit.hash);
    const window = windowIndex === undefined ? unreleasedWindow : (releasedWindows[windowIndex] ?? unreleasedWindow);
    window.commits.push(commit);
  }

  return [unreleasedWindow, ...releasedWindows.toReversed()];
}

// region | Helpers

/** The ancestry graph of the commits reachable from HEAD. */
interface Ancestry {
  /** Parent hashes per commit, which make containment answerable. */
  parentsByHash: Map<string, string[]>;
  /** Each commit's line in the topological walk; a larger position is older. */
  positionByHash: Map<string, number>;
}

/** A tag, the commit at which it points, and the date under which its release was published. */
interface TagBoundary {
  /** The commit at which the tag points, dereferenced for an annotated tag. */
  hash: string;
  /** The tagged commit's position in the topological walk. */
  position: number;
  tag: string;
  /** Unix seconds, from the tag's creation date. */
  timestampSec: number;
}

/**
 * Assigns each reachable commit to the boundary whose release first contained it, as an index
 * into `boundaries`. A commit not contained by any boundary is absent from the result.
 *
 * `boundaries` runs oldest release first, so each boundary claims only what the releases before
 * it left unclaimed. A topological walk puts an ancestor after its descendants, which
 * lets the caller order the boundaries without a second traversal.
 */
function claimAncestors(
  boundaries: readonly TagBoundary[],
  parentsByHash: ReadonlyMap<string, string[]>,
): Map<string, number> {
  const windowIndexByHash = new Map<string, number>();
  for (const [windowIndex, boundary] of boundaries.entries()) {
    const pendingHashes = [boundary.hash];
    while (pendingHashes.length > 0) {
      const hash = pendingHashes.pop();
      if (hash === undefined || windowIndexByHash.has(hash)) {
        continue;
      }
      windowIndexByHash.set(hash, windowIndex);
      pendingHashes.push(...(parentsByHash.get(hash) ?? []));
    }
  }
  return windowIndexByHash;
}

/** Reads the ancestry of every commit reachable from HEAD, empty for an unborn HEAD. */
function readAncestry(git: Git): Ancestry {
  const entries = runGitRead(() => git.readAncestry(), `'git rev-list' for HEAD`);

  const ancestry: Ancestry = { parentsByHash: new Map(), positionByHash: new Map() };
  for (const [position, { hash, parents }] of entries.entries()) {
    ancestry.parentsByHash.set(hash, parents);
    ancestry.positionByHash.set(hash, position);
  }
  return ancestry;
}

/** Reads every commit reachable from HEAD that touches one of the paths, newest first. */
function readCommits(git: Git, paths: readonly string[] | undefined): RawCommit[] {
  return runGitRead(() => git.readCommits(paths), `'git log' for HEAD`);
}

/** Reads the tags matching a prefix and reachable from HEAD, oldest release first. */
function readTagBoundaries(
  git: Git,
  tagPrefixes: readonly string[],
  positionByHash: ReadonlyMap<string, number>,
): TagBoundary[] {
  const refs = runGitRead(() => git.listTagRefs(), `'git for-each-ref' for refs/tags`);

  const boundaries: TagBoundary[] = [];
  for (const { tag, timestampSec, commitHash } of refs) {
    if (!matchesTagPrefix(tag, tagPrefixes)) {
      continue;
    }
    const position = positionByHash.get(commitHash);
    if (position !== undefined) {
      boundaries.push({ hash: commitHash, position, tag, timestampSec });
    }
  }

  return boundaries.toSorted((left, right) => right.position - left.position);
}

/** Runs a git read, chaining any failure to `description`. */
function runGitRead<T>(read: () => T, description: string): T {
  try {
    return read();
  } catch (error: unknown) {
    throw chainUserError(`Failed to run ${description}`, error);
  }
}

// endregion | Helpers
