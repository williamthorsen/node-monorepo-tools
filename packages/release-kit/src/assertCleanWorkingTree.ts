import { UserError } from '@williamthorsen/nmr-core';

import { type Git, realGit } from './git.ts';
import { asUserError } from './user-error-chaining.ts';

/** Throws if `git status --porcelain` reports any uncommitted change in the working tree. */
export function assertCleanWorkingTree(git: Git = realGit): void {
  let status: string;
  try {
    status = git.readStatus();
  } catch (error: unknown) {
    throw asUserError(error);
  }

  if (status.length > 0) {
    throw new UserError(
      'Working tree has uncommitted changes. Commit or stash them, or use --no-git-checks to bypass this check.',
    );
  }
}
