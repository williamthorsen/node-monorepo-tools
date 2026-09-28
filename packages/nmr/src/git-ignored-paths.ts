import { spawnSync } from 'node:child_process';

/**
 * Lists the untracked paths that git ignores under `dir`, relative to it and POSIX-separated, sorted. An ignored
 * directory is one entry ending in `/`, standing for everything beneath it; a tracked file never appears, whatever
 * pattern it matches.
 *
 * Returns an empty list whenever git does not answer, outside a repository or with git missing, so that a caller
 * excluding these paths over-reports rather than hides a path.
 */
export function listGitIgnoredPaths(dir: string): string[] {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory', '--no-empty-directory'],
    { cwd: dir, encoding: 'utf8' },
  );

  if (result.error !== undefined || result.status !== 0) return [];

  return result.stdout
    .split('\0')
    .filter((entry) => entry !== '')
    .toSorted();
}
