import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  acquireMachineLock,
  HEAVY_COMMANDS,
  LOCK_DIR_ENV_VAR,
  LOCK_TOKEN_ENV_VAR,
  NO_LOCK_ENV_VAR,
  resolveLockDir,
} from '../machine-lock.ts';

/** A pid above every platform's limit, which `kill` reports as not existing. */
const DEAD_PID = 2 ** 31 - 1;

describe(acquireMachineLock, () => {
  let workspace: TempTree;
  let lockDir: string;
  let lockPath: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-lock-' }));
    lockDir = workspace.resolve('locks');
    lockPath = path.join(lockDir, 'heavy.lock');
  });

  it('writes a lock file naming the holder, and removes it on release', async () => {
    const lock = await acquire({ command: 'test', dir: '/repo' });

    const holder: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(holder).toMatchObject({ command: 'test', dir: '/repo', pid: process.pid, token: lock.token });
    expect(lock.waited).toBe(false);

    await lock.release();

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('leaves a lock file that contains another token on release', async () => {
    const lock = await acquire();
    writeHolder({ token: 'someone-else' });

    await lock.release();

    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('waits for the holder, naming its command, directory, and pid once', async () => {
    const first = await acquire({ command: 'check', dir: '/first' });
    const stderr = captureStream();

    const second = acquire({ stderr: stderr.stream });
    await waitFor(() => stderr.read().includes('waiting'));
    await delay(50);
    await first.release();
    const secondLock = await second;

    expect(stderr.read()).toBe(`nmr: waiting for check in /first (pid ${process.pid}) to finish\n`);
    expect(secondLock.waited).toBe(true);
    expect(secondLock.token).toBeDefined();
    await secondLock.release();
  });

  it('runs under an ancestor hold whose token is in the lock file', async () => {
    const parent = await acquire();

    const child = await acquire({ env: { [LOCK_TOKEN_ENV_VAR]: parent.token } });

    expect(child).toMatchObject({ token: undefined, waited: false });
    await child.release();
    expect(fs.existsSync(lockPath)).toBe(true);
    await parent.release();
  });

  it('ignores an inherited token that the lock file does not contain', async () => {
    const lock = await acquire({ env: { [LOCK_TOKEN_ENV_VAR]: 'outlived-run' } });

    expect(lock.token).toBeDefined();
    expect(lock.token).not.toBe('outlived-run');
    await lock.release();
  });

  it('bypasses a held lock when NMR_NO_LOCK is 1', async () => {
    const holder = await acquire();

    const bypass = await acquire({ env: { [NO_LOCK_ENV_VAR]: '1' } });

    expect(bypass).toMatchObject({ token: undefined, waited: false });
    await holder.release();
  });

  it('reclaims a lock whose holder process no longer exists', async () => {
    writeHolder({ pid: DEAD_PID, token: 'dead' });
    const stderr = captureStream();

    const lock = await acquire({ stderr: stderr.stream });

    expect(lock.waited).toBe(false);
    expect(stderr.read()).toBe('');
    await lock.release();
  });

  it('reclaims a lock that its holder stopped refreshing', async () => {
    writeHolder({ token: 'frozen' });
    ageFile(lockPath);

    const lock = await acquire();

    expect(lock.token).not.toBe('frozen');
    await lock.release();
  });

  it('waits on a fresh lock file that does not parse, naming its path', async () => {
    workspace.write('locks/heavy.lock', '');
    const stderr = captureStream();

    const pending = acquire({ stderr: stderr.stream });
    await waitFor(() => stderr.read().includes('waiting'));
    fs.rmSync(lockPath);
    const lock = await pending;

    expect(stderr.read()).toBe(`nmr: waiting for the machine lock at ${lockPath}\n`);
    await lock.release();
  });

  it('reclaims an old lock file that does not parse', async () => {
    workspace.write('locks/heavy.lock', '{');
    ageFile(lockPath);

    const lock = await acquire();

    expect(lock.token).toBeDefined();
    await lock.release();
  });

  it('removes an abandoned reclaim guard and then reclaims', async () => {
    writeHolder({ pid: DEAD_PID, token: 'dead' });
    const guardPath = workspace.mkdir('locks/heavy.lock.reclaim');
    ageFile(guardPath);

    const lock = await acquire();

    expect(lock.token).toBeDefined();
    expect(fs.existsSync(guardPath)).toBe(false);
    await lock.release();
  });

  it('refreshes the lock file while held', async () => {
    const lock = await acquire({ heartbeatIntervalMs: 10 });
    ageFile(lockPath);

    await waitFor(() => Date.now() - fs.statSync(lockPath).mtimeMs < 10_000);
    await lock.release();

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('warns and runs without the lock when the directory cannot be written', async () => {
    const blockingFile = workspace.write('not-a-dir', '');
    const unwritableDir = path.join(blockingFile, 'locks');
    const stderr = captureStream();

    const lock = await acquire({ lockDir: unwritableDir, stderr: stderr.stream });

    expect(lock).toMatchObject({ token: undefined, waited: false });
    expect(stderr.read()).toContain(`nmr: running without the machine lock: cannot write ${unwritableDir}`);
    expect(stderr.read()).toContain(LOCK_DIR_ENV_VAR);
  });

  /** Acquires against the test's lock directory with intervals short enough for a test. */
  function acquire(overrides: Partial<Parameters<typeof acquireMachineLock>[0]> = {}) {
    return acquireMachineLock({
      command: 'test',
      dir: '/repo',
      env: {},
      heartbeatIntervalMs: 1_000,
      lockDir,
      pollIntervalMs: 10,
      staleAfterMs: 5_000,
      stderr: new PassThrough(),
      ...overrides,
    });
  }

  /** Writes a lock file as another holder would. */
  function writeHolder(overrides: { pid?: number; token: string }): void {
    workspace.writeJson('locks/heavy.lock', {
      command: 'test',
      dir: '/other',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      ...overrides,
    });
  }
});

describe(resolveLockDir, () => {
  it('returns the override when NMR_LOCK_DIR is set', () => {
    expect(resolveLockDir({ env: { [LOCK_DIR_ENV_VAR]: '/custom' }, platform: 'darwin', uid: 501 })).toBe('/custom');
  });

  it('returns a per-user directory under /tmp on POSIX', () => {
    expect(resolveLockDir({ env: {}, platform: 'linux', uid: 1_001 })).toBe('/tmp/nmr-1001');
  });

  it('returns a directory under the temp directory on Windows', () => {
    expect(resolveLockDir({ env: {}, platform: 'win32', uid: undefined })).toBe(path.join(os.tmpdir(), 'nmr'));
  });
});

describe('HEAVY_COMMANDS', () => {
  it('excludes test:watch, which runs until stopped', () => {
    expect(HEAVY_COMMANDS.has('test:watch')).toBe(false);
    expect(HEAVY_COMMANDS.has('test')).toBe(true);
  });
});

// region | Helpers

/** Sets a file's mtime an hour into the past. */
function ageFile(filePath: string): void {
  const past = new Date(Date.now() - 3_600_000);
  fs.utimesSync(filePath, past, past);
}

/** Returns a writable stream and a reader of everything written to it. */
function captureStream(): { read: () => string; stream: PassThrough } {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  return { read: () => output, stream };
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls until `condition` holds, failing after two seconds. */
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await delay(5);
  }
}

// endregion | Helpers
