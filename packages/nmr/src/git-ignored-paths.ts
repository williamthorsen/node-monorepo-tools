import { spawnSync } from 'node:child_process';

/**
 * Lists the untracked paths that git ignores under `dir`, relative to it and POSIX-separated, sorted. An ignored
 * directory is one entry ending in `/`, standing for everything beneath it; a tracked file never appears, whatever
 * pattern it matches.
 *
 * Returns an empty list wherever git gives no answer, outside a repository or with git missing. Empty widens scope
 * back to every path under `dir`, so a failure over-reports rather than hiding a test file.
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
