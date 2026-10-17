import { spawnSync } from 'node:child_process';

import { GIT_OUTPUT_LIMIT } from './gitOutputLimit.ts';

/** Git's stdout, or the reason that git failed. */
export type GitResult<T> = { ok: true; stdout: T } | { ok: false; error: string };

/**
 * Runs git and returns its stdout as text, or the reason it failed. A failure must never read as empty output: An
 * unreported change would leave a caller certifying content that is no longer there.
 */
export function runGit(args: string[], cwd: string, input?: string): GitResult<string> {
  const result = runGitForBytes(args, cwd, input === undefined ? undefined : Buffer.from(input, 'utf8'));
  return result.ok ? { ok: true, stdout: result.stdout.toString('utf8') } : result;
}

/**
 * Runs git without a shell, so that a shell never interprets any part of a path or revision, and returns its raw
 * stdout. `GIT_OPTIONAL_LOCKS=0` stops `git status` from writing its refreshed stat data back to the index.
 */
export function runGitForBytes(args: string[], cwd: string, input?: Buffer): GitResult<Buffer> {
  const result = spawnSync('git', args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    input,
    maxBuffer: GIT_OUTPUT_LIMIT,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    return { ok: false, error: stderr || `\`git ${args.join(' ')}\` failed with exit code ${result.status}.` };
  }

  return { ok: true, stdout: result.stdout };
}
