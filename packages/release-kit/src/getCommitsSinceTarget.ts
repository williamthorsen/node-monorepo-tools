import { execFileSync } from 'node:child_process';

import type { Commit } from './types.ts';

/**
 * Unit separator (U+001F) used to delimit fields in `git log` output.
 * Node.js v24+ rejects null bytes in child-process arguments, so we use
 * this ASCII control character instead. It cannot appear in commit
 * subject lines produced by git.
 */
const FIELD_SEPARATOR = '\u001F';

/**
 * Checks whether an error is the expected "no matching tag" failure from `git describe`.
 *
 * `git describe` exits with code 128 when no tag matches the given pattern.
 */
function isNoTagError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && err.status === 128;
}

/** Returns the error message from an unknown error value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Finds the closest reachable git tag whose name matches any of the given prefixes.
 *
 * Invokes `git describe --tags --abbrev=0` with one `--match=<prefix>*` per prefix. Git
 * treats multiple `--match` flags as a logical union, so the single invocation returns the
 * closest reachable ancestor matching any listed prefix.
 *
 * @returns The tag string, or undefined if no matching tag exists.
 * @throws If `tagPrefixes` is empty, or if `git describe` fails for a reason other than "no matching tag".
 */
function findLatestTag(tagPrefixes: readonly string[]): string | undefined {
  if (tagPrefixes.length === 0) {
    throw new Error('findLatestTag: tagPrefixes must contain at least one entry');
  }
  const matchArgs = tagPrefixes.map((prefix) => `--match=${prefix}*`);
  try {
    const tagResult = execFileSync('git', ['describe', '--tags', '--abbrev=0', ...matchArgs], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return tagResult || undefined;
  } catch (error: unknown) {
    if (isNoTagError(error)) {
      return undefined;
    }
    throw new Error(`Failed to run 'git describe': ${errorMessage(error)}`);
  }
}

/**
 * Prefix used by the release workflow's commit message (e.g., `release: arrays-v1.0.0`).
 * Commits with this prefix are filtered out so they never influence bump decisions.
 */
const RELEASE_COMMIT_PREFIX = 'release:';

/** Parses the raw `git log` output into an array of commits, excluding release commits. */
function parseLogOutput(logOutput: string): Commit[] {
  const commits: Commit[] = [];

  for (const line of logOutput.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine === '') {
      continue;
    }

    const [message, hash] = trimmedLine.split(FIELD_SEPARATOR);

    if (message !== undefined && hash !== undefined && !message.startsWith(RELEASE_COMMIT_PREFIX)) {
      commits.push({ message, hash });
    }
  }

  return commits;
}

/**
 * Gets commits since the latest baseline tag matching any of the given prefixes.
 *
 * Uses `git log` to retrieve commit messages and hashes between the closest reachable
 * baseline tag and HEAD. When no tag matches any prefix, all commits reachable from HEAD
 * are returned.
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
): { tag: string | undefined; commits: Commit[] } {
  const tag = findLatestTag(tagPrefixes);
  const range = tag === undefined ? 'HEAD' : `${tag}..HEAD`;
  const format = `%s${FIELD_SEPARATOR}%H`;

  const args = ['log', range, `--pretty=format:${format}`];

  // Append path filters after the `--` separator when provided.
  if (paths !== undefined && paths.length > 0) {
    args.push('--', ...paths);
  }

  let logOutput: string;
  try {
    logOutput = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: unknown) {
    throw new Error(`Failed to run 'git log' for range '${range}': ${errorMessage(error)}`);
  }

  if (logOutput === '') {
    return { tag, commits: [] };
  }

  return { tag, commits: parseLogOutput(logOutput) };
}
