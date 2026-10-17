import { execFileSync } from 'node:child_process';

/** Initializes a repository at `dir` and commits everything in it. */
export function initRepo(dir: string): void {
  runGit(dir, ['init', '--quiet', '--initial-branch=main']);
  runGit(dir, ['config', 'user.email', 'fixture@example.com']);
  runGit(dir, ['config', 'user.name', 'Fixture']);
  runGit(dir, ['config', 'commit.gpgsign', 'false']);
  runGit(dir, ['add', '--all']);
  runGit(dir, ['commit', '--quiet', '--message', 'initial']);
}

// region | Helpers

/** Runs git in `cwd`. */
function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, encoding: 'utf8' });
}

// endregion | Helpers
