import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The exact `git-cliff` version every invocation resolves.
 *
 * npm's `git-cliff` trails the upstream release, so this pin normally sits behind the newest version cliff
 * itself reports. Bumping it is an edit to this line, once npm publishes the version you want.
 */
export const GIT_CLIFF_VERSION = '2.13.1';

/** The npx arguments that precede the cliff args at every invocation, and that the dry-run report renders. */
export const GIT_CLIFF_NPX_ARGS: readonly string[] = ['--prefer-offline', '--yes', `git-cliff@${GIT_CLIFF_VERSION}`];

/**
 * Invokes `git-cliff` via `npx` and returns the output it produced.
 *
 * Single entry point for `git-cliff` invocations from `release-kit`. Owns three pieces of shared lifecycle
 * that would otherwise duplicate (and silently drift) across call sites: the npx flags, the spawned-process
 * environment, and the temp dir holding both the `.template`→`.toml` config copy and cliff's output file.
 *
 * Output is routed through `--output` to a temp file and read back. `--context` emits a workspace's
 * entire matching tag history on every run, so its size grows without bound with the repo;
 * a file accommodates that, while a pipe is bounded by `maxBuffer`.
 *
 * The npx spec names an exact version, which leaves npm no staleness to check, so `--prefer-offline` skips the
 * per-call registry revalidation round-trip (~2.5 s per invocation on a warm cache) without stranding the run
 * on whatever the cache happens to hold.
 *
 * Two env entries are set for the child. `npm_config_progress=false` suppresses npx's animated stderr spinner,
 * which otherwise renders as a transient flicker. `RUST_LOG=warn` drops cliff's INFO lines, among them the
 * crates.io update notice it emits on every invocation while npm trails upstream, and leaves warnings and errors
 * in place; an inherited `RUST_LOG` wins, so raising the level for debugging still works.
 *
 * The helper injects `--config <path>` and `--output <path>` itself — callers must NOT include either in `cliffArgs`.
 * `--output` is appended last so a caller that passes one anyway cannot redirect the output the helper then reads.
 * The caller is responsible for resolving the cliff config path (via `resolveCliffConfigPath`) before calling,
 * since the resolution depends on the caller's `import.meta.url`.
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
    execFileSync('npx', [...GIT_CLIFF_NPX_ARGS, '--config', configPath, ...cliffArgs, '--output', outputPath], {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, npm_config_progress: 'false', RUST_LOG: process.env['RUST_LOG'] ?? 'warn' },
    });

    return readFileSync(outputPath, 'utf8');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
