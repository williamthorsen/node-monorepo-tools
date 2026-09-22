import { enumerateReleaseWindows, type RawCommit } from './enumerateReleaseWindows.ts';

/**
 * Prefix used by the release workflow's commit message (e.g., `release: arrays-v1.0.0`).
 * Commits with this prefix are filtered out so they never influence bump decisions.
 */
const RELEASE_COMMIT_PREFIX = 'release:';

/**
 * Placeholder version for the window being built, which this caller reads for its commits alone.
 */
const UNRELEASED_TAG = 'unreleased';

/**
 * Gets commits since the latest baseline tag matching any of the given prefixes.
 *
 * Reads the newest window `enumerateReleaseWindows` produces: its commits are the ones since
 * the closest reachable baseline tag, and the window below it names that tag. When no tag
 * matches any prefix, every commit reachable from HEAD falls into the newest window and the
 * returned tag is undefined.
 *
 * Release commits are dropped here rather than in the enumerator, which reports the window as
 * git records it and leaves each reader to apply its own gate. The window's commits are
 * reversed back to newest first, the order `git log` gave this caller and the order in which
 * `buildReleaseSummary` lists them in the release commit's body.
 *
 * Callers must pass at least one prefix; the single-prefix case is the common one (the
 * workspace's derived prefix). Multiple prefixes are used to include historical tag prefixes
 * from `legacyIdentities`.
 *
 * @param tagPrefixes - Tag prefixes to search as a union (e.g., `['core-v', 'old-core-v']`).
 * @param paths - Optional glob patterns to filter commits by path (appended after `--` in `git log`).
 *   Path patterns use POSIX-style forward slashes; Windows compatibility is not guaranteed.
 * @returns An object with the found tag (if any) and the list of commits.
 */
export function getCommitsSinceTarget(
  tagPrefixes: readonly string[],
  paths?: string[],
): { tag: string | undefined; commits: RawCommit[] } {
  const [unreleasedWindow, baselineWindow] = enumerateReleaseWindows({
    ...(paths !== undefined && { paths }),
    tagPrefixes,
    unreleasedTag: UNRELEASED_TAG,
  });

  const commits = (unreleasedWindow?.commits ?? [])
    .filter((commit) => !commit.subject.startsWith(RELEASE_COMMIT_PREFIX))
    .toReversed();

  return { tag: baselineWindow?.version, commits };
}
