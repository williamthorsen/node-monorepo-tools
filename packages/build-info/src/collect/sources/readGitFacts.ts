import { execFileSync } from 'node:child_process';

/** What git reports about the checkout in a directory; a field that git could not supply is absent. */
export interface GitFacts {
  sha?: string;
  ref?: string;
  /** Subject line of the `HEAD` commit. */
  message?: string;
  author?: string;
  /** Committer date of the `HEAD` commit, ISO 8601. */
  time?: string;
  /** Whether a tracked file differs from `HEAD`. */
  dirty?: boolean;
  /** URL of the `origin` remote. */
  remoteUrl?: string;
}

/**
 * Reads the checkout in `cwd` through git. Never throws: an absent `.git`, an absent `git` binary, or a failing
 * command leaves that command's fields absent.
 */
export function readGitFacts(cwd: string): GitFacts {
  const facts: GitFacts = {};

  const [sha, message, author, time] = runGit(cwd, ['log', '-1', '--format=%H%x00%s%x00%an%x00%cI'])?.split('\0') ?? [];
  assignIfPresent(facts, 'sha', sha);
  assignIfPresent(facts, 'message', message);
  assignIfPresent(facts, 'author', author);
  assignIfPresent(facts, 'time', time);

  const ref = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  // A detached `HEAD` reports the literal `HEAD` rather than a branch name.
  if (ref !== 'HEAD') {
    assignIfPresent(facts, 'ref', ref);
  }

  const status = runGit(cwd, ['status', '--porcelain', '--untracked-files=no']);
  if (status !== undefined) {
    facts.dirty = status.length > 0;
  }

  assignIfPresent(facts, 'remoteUrl', runGit(cwd, ['remote', 'get-url', 'origin']));

  return facts;
}

// region | Helpers

/** Sets a string field when the value is a non-empty string. */
function assignIfPresent(
  facts: GitFacts,
  key: 'author' | 'message' | 'ref' | 'remoteUrl' | 'sha' | 'time',
  value: string | undefined,
): void {
  if (value !== undefined && value.length > 0) {
    facts[key] = value;
  }
}

/** Runs a git command in `cwd` and returns its trimmed output, or `undefined` when it cannot run or exits non-zero. */
function runGit(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

// endregion | Helpers
