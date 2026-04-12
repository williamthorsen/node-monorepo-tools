import { execFileSync } from 'node:child_process';

/**
 * Verify that the git working tree has no uncommitted changes.
 *
 * @throws If `git status --porcelain` reports any changes.
 */
export function assertCleanWorkingTree(): void {
  const status = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  if (status.length > 0) {
    throw new Error(
      'Working tree has uncommitted changes. Commit or stash them before running prepare, or use --no-git-checks to bypass this check.',
    );
  }
}
