import { execFileSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT } from '@williamthorsen/nmr-core';

/** Throws if `git status --porcelain` reports any uncommitted change in the working tree. */
export function assertCleanWorkingTree(): void {
  const status = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_LIMIT,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  if (status.length > 0) {
    throw new Error(
      'Working tree has uncommitted changes. Commit or stash them, or use --no-git-checks to bypass this check.',
    );
  }
}
