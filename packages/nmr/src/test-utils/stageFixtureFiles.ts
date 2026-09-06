import { execFileSync } from 'node:child_process';

/**
 * Initializes a git repository over a fixture tree and stages every file the tree's own `.gitignore` allows.
 *
 * Staging is as far as this goes: `git ls-files` reads the index, so nothing that reads a tracked listing needs a
 * commit, nor the identity that the suite's git isolation withholds.
 */
export function stageFixtureFiles(dir: string): void {
  execFileSync('git', ['-C', dir, 'init', '--quiet'], { stdio: 'ignore' });
  execFileSync('git', ['-C', dir, 'add', '--all'], { stdio: 'ignore' });
}
