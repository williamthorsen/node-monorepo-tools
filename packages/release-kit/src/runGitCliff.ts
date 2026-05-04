import { execFileSync, type StdioOptions } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Invoke `git-cliff` via `npx`, returning its stdout as a string.
 *
 * Single entry point for `git-cliff` invocations from `release-kit`. Owns three pieces of
 * shared lifecycle that would otherwise duplicate (and silently drift) across call sites:
 * the npx flags, the spawned-process environment, and the `.template`→temp `.toml` copy.
 *
 * The `--prefer-offline` flag and `npm_config_progress=false` env entry are deliberate:
 * `--prefer-offline` skips npx's per-call npm-registry revalidation HTTP round-trip
 * (~2.5 s per invocation on a warm cache), and `npm_config_progress=false` suppresses
 * npx's animated stderr spinner, which otherwise renders as a transient flicker.
 *
 * The helper injects `--config <path>` itself — callers must NOT include `--config` in
 * `cliffArgs`. The caller is responsible for resolving the cliff config path (via
 * `resolveCliffConfigPath`) before calling, since the resolution depends on the caller's
 * `import.meta.url`.
 *
 * Errors from `execFileSync` are not caught: callers wrap with site-specific messages.
 * The temp-dir cleanup runs in a `finally` so it still happens on throw.
 */
export function runGitCliff(cliffConfigPath: string, cliffArgs: readonly string[], stdio: StdioOptions): string {
  let configPath = cliffConfigPath;
  let tempDir: string | undefined;
  try {
    // git-cliff rejects non-.toml extensions. Copy bundled .template files to a temp .toml file.
    if (cliffConfigPath.endsWith('.template')) {
      tempDir = mkdtempSync(join(tmpdir(), 'cliff-'));
      configPath = join(tempDir, 'cliff.toml');
      copyFileSync(cliffConfigPath, configPath);
    }

    return execFileSync('npx', ['--prefer-offline', '--yes', 'git-cliff', '--config', configPath, ...cliffArgs], {
      encoding: 'utf8',
      stdio,
      env: { ...process.env, npm_config_progress: 'false' },
    });
  } finally {
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
