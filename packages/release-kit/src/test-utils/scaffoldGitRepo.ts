import { execFileSync } from 'node:child_process';

import { createTempTree, pointCwdAt } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';

/** A temp git repository, with the shorthands a history fixture builds itself from. */
export interface GitRepoFixture {
  /** The repository's absolute path. */
  dir: string;
  /** Writes the files, stages everything, commits, and returns the new commit's full hash. */
  commit: (message: string, files?: Record<string, string>) => string;
  /** Runs a git command in the repository and returns its trimmed stdout. */
  git: (...args: string[]) => string;
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

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: tree.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test User');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgSign', 'false');

  disposeOnTestFinished(pointCwdAt(tree.dir, { chdir: true }));

  return {
    dir: tree.dir,
    commit: (message, files) => {
      for (const [path, contents] of Object.entries(files ?? {})) {
        tree.write(path, contents);
      }
      git('add', '-A');
      git('commit', '--quiet', '--allow-empty', '--message', message);
      return git('rev-parse', 'HEAD');
    },
    git,
    tag: (name) => {
      git('tag', '--annotate', name, '--message', name);
    },
  };
}
