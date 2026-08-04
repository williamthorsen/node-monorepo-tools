import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GIT_OUTPUT_LIMIT } from '@williamthorsen/nmr-core';

/**
 * Invokes `git-cliff` via `npx` and returns the output it produced.
 *
 * Single entry point for `git-cliff` invocations from `release-kit`. Owns three pieces of
 * shared lifecycle that would otherwise duplicate (and silently drift) across call sites:
 * the npx flags, the spawned-process environment, and the temp dir holding both the
 * `.template`→`.toml` config copy and cliff's output file.
 *
 * Output is routed through `--output` to a temp file and read back. `--context` emits a
 * workspace's entire matching tag history on every run, so its size grows without bound with
 * the repo; a file accommodates that, while a pipe is bounded by `maxBuffer`.
 *
 * The `--prefer-offline` flag and `npm_config_progress=false` env entry are deliberate:
 * `--prefer-offline` skips npx's per-call npm-registry revalidation HTTP round-trip
 * (~2.5 s per invocation on a warm cache), and `npm_config_progress=false` suppresses
 * npx's animated stderr spinner, which otherwise renders as a transient flicker.
 *
 * Because `--prefer-offline` also suppresses npx's cache-staleness check, the cached
 * `git-cliff` binary would otherwise drift further and further behind upstream, with each
 * cliff invocation re-emitting the "A new version of git-cliff is available" notice and
 * the local cache never updating. `refreshGitCliffCache` (below) revalidates the cache
 * once at the top of each `prepare` run so subsequent `--prefer-offline` calls run against
 * a current binary.
 *
 * The helper injects `--config <path>` and `--output <path>` itself — callers must NOT
 * include either in `cliffArgs`. `--output` is appended last so a caller that passes one
 * anyway cannot redirect the output the helper then reads. The caller is responsible for
 * resolving the cliff config path (via `resolveCliffConfigPath`) before calling, since the
 * resolution depends on the caller's `import.meta.url`.
 *
 * Errors from `execFileSync` are not caught: callers wrap with site-specific messages.
 * The temp-dir cleanup runs in a `finally` so it still happens on throw.
 */
export function runGitCliff(cliffConfigPath: string, cliffArgs: readonly string[]): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'cliff-'));
  try {
    // git-cliff rejects non-.toml extensions. Copy bundled .template files to a temp .toml file.
    let configPath = cliffConfigPath;
    if (cliffConfigPath.endsWith('.template')) {
      configPath = join(tempDir, 'cliff.toml');
      copyFileSync(cliffConfigPath, configPath);
    }

    const outputPath = join(tempDir, 'output.json');

    // stdout carries nothing once `--output` is set, and discarding it leaves no parent-side buffer.
    // stderr is inherited so npx and cliff errors reach the terminal.
    execFileSync(
      'npx',
      ['--prefer-offline', '--yes', 'git-cliff', '--config', configPath, ...cliffArgs, '--output', outputPath],
      {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, npm_config_progress: 'false' },
      },
    );

    return readFileSync(outputPath, 'utf8');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Revalidate npx's cache for `git-cliff` once per `prepare` run.
 *
 * Spawns `npx --yes git-cliff --version` *without* `--prefer-offline`, so npm performs its
 * normal registry-staleness check and refreshes the cached binary if a newer version is
 * available. Subsequent `runGitCliff` calls within the same run keep `--prefer-offline`
 * (preserving the per-call perf win) but now run against an up-to-date cache, so
 * git-cliff's own self-update notice no longer fires repeatedly.
 *
 * Stdio: stdin ignored, stdout piped (the version line is suppressed as noise), stderr
 * inherited (npm errors and any rare upgrade notice surface, but only once per run).
 * `maxBuffer` is declared even though the piped output is a single version line, because every
 * call that pipes stdout declares one.
 *
 * Errors propagate unchanged — a failed cache refresh fails the prepare run loudly rather
 * than silently degrading.
 */
export function refreshGitCliffCache(): void {
  execFileSync('npx', ['--yes', 'git-cliff', '--version'], {
    maxBuffer: GIT_OUTPUT_LIMIT,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, npm_config_progress: 'false' },
  });
}
