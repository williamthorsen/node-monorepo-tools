/**
 * Vitest global-setup file that gives each run a temp directory of its own and removes it when the run ends.
 *
 * A test that omits cleanup, and a program that a tool test spawns, otherwise leave their scratch files in the shared
 * temp directory, where the leftovers of every run and repository accumulate until a tmpfs with a fixed inode count
 * has none left. Workers and the processes that tests spawn inherit `TMPDIR`, so everything that resolves the temp
 * directory through it writes inside the run directory.
 *
 * A run stopped by a signal skips global teardown, so setup first removes every run directory whose owning process
 * has exited.
 *
 * `defineVitestConfig` loads this into the root config by default; see nmr's `shouldIsolateTempDir` option.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { hasErrnoCode } from '@williamthorsen/nmr-core';

const RUN_DIR_PREFIX = 'nmr-vitest-';

/** Matches a run directory's name and captures the PID of the process that created it. */
const RUN_DIR_PATTERN = /^nmr-vitest-([1-9]\d*)-./;

/** Creates this run's temp directory, points `TMPDIR` at it, and returns the teardown that removes it. */
export function setup(): () => void {
  const baseDir = os.tmpdir();
  removeOrphanedRunDirs(baseDir);

  const runDir = fs.mkdtempSync(path.join(baseDir, `${RUN_DIR_PREFIX}${process.pid}-`));
  const previousTmpdir = process.env['TMPDIR'];
  process.env['TMPDIR'] = runDir;

  return function teardown(): void {
    if (previousTmpdir === undefined) {
      delete process.env['TMPDIR'];
    } else {
      process.env['TMPDIR'] = previousTmpdir;
    }

    // A process that a test spawned may still be writing into the directory, which fails a single removal attempt.
    fs.rmSync(runDir, { force: true, maxRetries: 5, recursive: true });
  };
}

// region | Helpers

/** Reports whether a process has exited. A process that this one may not signal still exists. */
function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasErrnoCode(error, 'ESRCH');
  }
}

/**
 * Removes each run directory in `baseDir` whose owning process has exited. An entry that cannot be removed is left in
 * place, because a failed sweep leaves the state that the run found, whereas a thrown error would stop every run.
 */
function removeOrphanedRunDirs(baseDir: string): void {
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const pidText = RUN_DIR_PATTERN.exec(entry.name)?.[1];
    if (!entry.isDirectory() || pidText === undefined || !isProcessGone(Number(pidText))) continue;

    try {
      fs.rmSync(path.join(baseDir, entry.name), { force: true, recursive: true });
    } catch {
      // Leave the entry to a later sweep.
    }
  }
}

// endregion | Helpers
