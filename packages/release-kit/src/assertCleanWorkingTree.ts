import { execFileSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT_BYTES, UserError } from '@williamthorsen/nmr-core';

import { asUserError } from './user-error-chaining.ts';

/** Throws if `git status --porcelain` reports any uncommitted change in the working tree. */
export function assertCleanWorkingTree(): void {
  let status: string;
  try {
    status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: unknown) {
    throw asUserError(error);
  }

  if (status.length > 0) {
    throw new UserError(
      'Working tree has uncommitted changes. Commit or stash them, or use --no-git-checks to bypass this check.',
    );
  }
}
