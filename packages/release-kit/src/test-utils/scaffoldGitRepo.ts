import { execFileSync } from 'node:child_process';

import { createTempTree, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';

/** When a commit is dated, which decides the order a date-ordered walk reports it in. */
export interface CommitDate {
  /** A date git accepts, such as `2026-01-02T00:00:00Z`. Defaults to the clock. */
  date?: string;
}

/** A temp git repository, with the shorthands a history fixture builds itself from. */
export interface GitRepoFixture {
  /** The repository's absolute path. */
  dir: string;
  /** Writes the files, stages everything, commits, and returns the new commit's full hash. */
  commit: (message: string, files?: Record<string, string>, options?: CommitDate) => string;
  /** Runs a git command in the repository and returns its trimmed stdout. */
  git: (...args: string[]) => string;
  /** Merges a branch without fast-forwarding, and returns the merge commit's full hash. */
  merge: (branch: string, message: string, options?: CommitDate) => string;
  /** Writes an annotated tag at HEAD, as `createTags.ts` does. */
  tag: (name: string) => void;
}

/**
 * Builds a git repository in a temp directory and points the process at it for the test.
 *
 * Release-kit invokes git through child processes that inherit the process's working
 * directory, so the fixture changes it for real rather than stubbing `process.cwd()`.
 *
 * The repository sets its own identity and disables signing, so a commit needs no global git
 * configuration on the host.
 */
export function scaffoldGitRepo(entries: Record<string, string> = {}): GitRepoFixture {
  const tree = disposeOnTestFinished(createTempTree(entries, { prefix: 'release-kit-git-' }));

  function runGit(args: readonly string[], date?: string): string {
    return execFileSync('git', args, {
      cwd: tree.dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(date !== undefined && { env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }),
    }).trim();
  }

  runGit(['init', '--quiet', '--initial-branch=main']);
  runGit(['config', 'user.email', 'test@example.com']);
  runGit(['config', 'user.name', 'Test User']);
  runGit(['config', 'commit.gpgsign', 'false']);
  runGit(['config', 'tag.gpgSign', 'false']);

  disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));

  return {
    dir: tree.dir,
    commit: (message, files, options) => {
      const fileEntries = Object.entries(files ?? {});
      for (const [path, contents] of fileEntries) {
        tree.write(path, contents);
      }
      runGit(['add', '-A']);
      runGit(['commit', '--quiet', '--allow-empty', '--message', message], options?.date);
      return runGit(['rev-parse', 'HEAD']);
    },
    git: (...args) => runGit(args),
    merge: (branch, message, options) => {
      runGit(['merge', '--quiet', '--no-ff', branch, '--message', message], options?.date);
      return runGit(['rev-parse', 'HEAD']);
    },
    tag: (name) => {
      runGit(['tag', '--annotate', name, '--message', name]);
    },
  };
}
