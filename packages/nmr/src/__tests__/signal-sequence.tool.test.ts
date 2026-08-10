import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const CLI_PATH = path.join(MONOREPO_ROOT, 'packages', 'nmr', 'dist', 'esm', 'cli.js');
const BIN_DIR = path.join(MONOREPO_ROOT, 'node_modules', '.bin');

/** How long the first step waits before giving up, so nothing it spawned outlives the test as an orphan. */
const FIRST_STEP_WAIT_MS = 5_000;

/** How long to wait for a marker before calling the step that writes it stalled. */
const MARKER_TIMEOUT_MS = 20_000;

describe('signal handling', () => {
  let repo: string;
  let child: ChildProcess | undefined;

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-signal-')));
    fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    fs.mkdirSync(path.join(repo, '.config'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.config', 'nmr.config.ts'), `export default ${JSON.stringify(config())};\n`);
  });

  afterEach(() => {
    if (child?.pid !== undefined && child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(repo, { recursive: true, force: true });
  });

  // nmr installs no signal handler: the sequence ends because nmr is what holds it, where the shell it used to
  // spawn outlived the request and ran the rest of the chain with nobody watching.
  it('given a signal to nmr alone, never starts the steps after the one that was running', async () => {
    child = spawn(process.execPath, [CLI_PATH, 'sequence'], {
      cwd: repo,
      env: childEnv(),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForMarker(path.join(repo, 'first-started'));
    process.kill(requirePid(child), 'SIGINT');
    const exitCode = await waitForExit(child);

    expect(exitCode).not.toBe(0);
    expect(fs.existsSync(path.join(repo, 'second-ran'))).toBe(false);
  }, 40_000);

  // Keeps the test above honest: absence of the second marker means the signal stopped the sequence, not that
  // the fixture never reached the second step under any circumstances.
  it('runs the second step when no signal arrives', async () => {
    child = spawn(process.execPath, [CLI_PATH, 'control'], {
      cwd: repo,
      env: childEnv(),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const exitCode = await waitForExit(child);

    expect(exitCode).toBe(0);
    expect(fs.existsSync(path.join(repo, 'second-ran'))).toBe(true);
  }, 40_000);
});

// region | Helpers

/** The environment the run needs: `nmr` on PATH for the argv spawn, and no inherited pass to skip on. */
function childEnv(): NodeJS.ProcessEnv {
  const { NMR_TREE_SNAPSHOT: _snapshot, NMR_NO_CACHE: _noCache, NMR_DEBUG: _debug, ...ambient } = process.env;

  return { ...ambient, PATH: `${BIN_DIR}${path.delimiter}${ambient['PATH'] ?? ''}` };
}

/**
 * Two composites over the same second step: `sequence`, whose first step announces itself and then waits long
 * enough to be signalled, and `control`, which runs straight through. The wait is bounded so the process tree
 * orphaned by killing nmr goes away on its own rather than lingering past the suite.
 */
function config(): Record<string, unknown> {
  const announce = `node -e "require('node:fs').writeFileSync('first-started',''); setTimeout(() => {}, ${FIRST_STEP_WAIT_MS})"`;
  const second = `node -e "require('node:fs').writeFileSync('second-ran','')"`;

  return {
    rootScripts: {
      control: ['control:first', 'sequence:second'],
      'control:first': `node -e "require('node:fs').writeFileSync('first-started','')"`,
      sequence: ['sequence:first', 'sequence:second'],
      'sequence:first': announce,
      'sequence:second': second,
    },
  };
}

/** Returns the process id, failing the test when the process never started. */
function requirePid(target: ChildProcess): number {
  const { pid } = target;
  if (pid === undefined) throw new Error('nmr did not start');
  return pid;
}

/** Resolves with the exit code once the process has ended. */
function waitForExit(target: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => target.on('exit', (code: number | null) => resolve(code)));
}

/** Resolves once the file exists, so the signal lands while the first step is running rather than before it. */
async function waitForMarker(markerPath: string): Promise<void> {
  const deadline = Date.now() + MARKER_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (fs.existsSync(markerPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`the first step never wrote ${markerPath}`);
}

// endregion | Helpers
