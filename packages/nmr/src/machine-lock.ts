import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { type OutputStyle, STATUS_GLYPHS } from '@williamthorsen/nmr-core';

import { isObject } from './helpers/type-guards.ts';

/** Serializes reclaims of a stale lock, so that one waiter's reclaim cannot remove the lock that another just took. */
const RECLAIM_GUARD = 'heavy.lock.reclaim';

/** Age at which a reclaim guard counts as abandoned; a reclaim takes a few filesystem calls. */
const RECLAIM_GUARD_STALE_AFTER_MS = 10_000;

/** How often a holder refreshes the lock file's mtime. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * The commands that take the machine lock: the ones whose memory peak makes two concurrent runs slower than two in
 * sequence. `test:watch` is absent because it runs until it is stopped, and holding the lock would block every other
 * run for as long.
 */
export const HEAVY_COMMANDS: ReadonlySet<string> = new Set([
  'check',
  'check:strict',
  'ci',
  'root:check',
  'root:test',
  'root:test:all',
  'root:test:tool',
  'root:test:unit',
  'test',
  'test:all',
  'test:coverage',
  'test:tool',
  'test:unit',
]);

/** Overrides the directory that contains the lock file. */
export const LOCK_DIR_ENV_VAR = 'NMR_LOCK_DIR';

/** The lock file's name in the lock directory. */
export const LOCK_FILE = 'heavy.lock';

/** Passes the holder's token to the processes below it, which run under its hold rather than waiting on it. */
export const LOCK_TOKEN_ENV_VAR = 'NMR_MACHINE_LOCK_TOKEN';

/** Set to `1` to run without the lock, for the whole chain. */
export const NO_LOCK_ENV_VAR = 'NMR_NO_LOCK';

/** How often a waiter checks the lock again. */
export const POLL_INTERVAL_MS = 1_000;

/**
 * Age at which an unrefreshed lock file is abandoned. It covers a holder whose pid was reused by another process,
 * and a file left half-written, neither of which a liveness check detects.
 */
export const STALE_AFTER_MS = 60_000;

/** A taken lock, or the hold-free stand-in for a run that does not take one. */
export interface MachineLock {
  /**
   * Whether the chain runs without the lock: the bypass is set, or the lock directory cannot be written. The processes
   * below then skip the lock rather than each trying it again and repeating the warning.
   */
  isChainUnlocked: boolean;
  release: () => Promise<void>;
  /** The token in the lock file, when this call took the lock. */
  token: string | undefined;
  /** Whether the call waited for another holder before returning. */
  waited: boolean;
}

/** The contents of the lock file. */
interface HolderRecord {
  command: string;
  dir: string;
  pid: number;
  startedAt: string;
  token: string;
}

/** What a reader observed of the lock file: its parsed holder, when it parsed, and its mtime. */
interface LockState {
  holder: HolderRecord | undefined;
  mtimeMs: number;
}

/**
 * Takes the machine lock, waiting while another process holds it. Resolves to a hold-free lock without waiting when
 * the bypass is set, when this process runs under an ancestor's hold, or when the lock directory cannot be written.
 */
export async function acquireMachineLock(options: {
  command: string;
  dir: string;
  env: NodeJS.ProcessEnv;
  stderr: Writable;
  heartbeatIntervalMs?: number;
  lockDir?: string;
  pollIntervalMs?: number;
  staleAfterMs?: number;
}): Promise<MachineLock> {
  const { command, dir, env, stderr } = options;

  if (env[NO_LOCK_ENV_VAR] === '1') {
    return createHoldFreeLock({ isChainUnlocked: true, waited: false });
  }

  const lockDir = options.lockDir ?? resolveLockDir({ env, platform: process.platform, uid: process.getuid?.() });
  if (await isUnderAncestorHold(lockDir, env)) {
    return createHoldFreeLock({ isChainUnlocked: false, waited: false });
  }
  const lockPath = path.join(lockDir, LOCK_FILE);

  try {
    await fs.mkdir(lockDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    reportUnwritableDir(lockDir, error, stderr);
    return createHoldFreeLock({ isChainUnlocked: true, waited: false });
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? STALE_AFTER_MS;
  const record: HolderRecord = {
    command,
    dir,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  };
  let waited = false;
  let reportedHolder: string | undefined;

  for (;;) {
    try {
      await fs.writeFile(lockPath, JSON.stringify(record), { flag: 'wx' });
      return createHeldLock({ heartbeatIntervalMs, lockPath, token: record.token, waited });
    } catch (error) {
      if (readErrorCode(error) !== 'EEXIST') {
        reportUnwritableDir(lockDir, error, stderr);
        return createHoldFreeLock({ isChainUnlocked: true, waited });
      }
    }

    const state = await readLockState(lockPath);
    if (state === undefined) {
      continue;
    }
    if (isStale(state, staleAfterMs)) {
      await reclaimStaleLock({ lockDir, lockPath, observed: state, staleAfterMs });
      continue;
    }

    const holderIdentity = state.holder?.token ?? 'unreadable';
    if (holderIdentity !== reportedHolder) {
      stderr.write(`${formatWaitingLine(state.holder, lockPath)}\n`);
      reportedHolder = holderIdentity;
    }
    waited = true;
    await delay(pollIntervalMs);
  }
}

/**
 * Renders the warning for a `--no-lock` that appears after the command name, which makes it an argument to the
 * command rather than a flag to nmr.
 */
export function formatMisplacedNoLockWarning(command: string, style: OutputStyle): string {
  return (
    `${STATUS_GLYPHS[style].warning.text} --no-lock after the command name is passed to \`${command}\`, ` +
    `not read by nmr. Did you mean \`nmr --no-lock ${command}\`?`
  );
}

/**
 * Returns the directory that contains the lock file: one per user under `/tmp`, which a sandboxed session and a
 * terminal resolve alike, where `TMPDIR` does not. Windows does not have `/tmp` or a uid.
 */
export function resolveLockDir(options: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  uid: number | undefined;
}): string {
  const { env, platform, uid } = options;

  const override = env[LOCK_DIR_ENV_VAR];
  if (override !== undefined && override !== '') {
    return override;
  }
  if (platform === 'win32' || uid === undefined) {
    return path.join(os.tmpdir(), 'nmr');
  }

  return `/tmp/nmr-${uid}`;
}

// region | Helpers

/** Returns a lock that refreshes its file until released, and removes the file only while it still contains its token. */
function createHeldLock(options: {
  heartbeatIntervalMs: number;
  lockPath: string;
  token: string;
  waited: boolean;
}): MachineLock {
  const { heartbeatIntervalMs, lockPath, token, waited } = options;

  const heartbeat = setInterval(() => void refreshMtime(lockPath), heartbeatIntervalMs);
  heartbeat.unref();

  let isReleased = false;

  return {
    isChainUnlocked: false,
    async release() {
      if (isReleased) return;
      isReleased = true;
      clearInterval(heartbeat);

      const state = await readLockState(lockPath);
      if (state?.holder?.token === token) {
        await fs.rm(lockPath, { force: true });
      }
    },
    token,
    waited,
  };
}

/** Returns a lock whose release does nothing. */
function createHoldFreeLock(options: { isChainUnlocked: boolean; waited: boolean }): MachineLock {
  return { ...options, release: () => Promise.resolve(), token: undefined };
}

/** Renders the line that a waiter prints when it starts waiting on a holder. */
function formatWaitingLine(holder: HolderRecord | undefined, lockPath: string): string {
  if (holder === undefined) {
    return `nmr: waiting for the machine lock at ${lockPath}`;
  }

  return `nmr: waiting for ${holder.command} in ${holder.dir} (pid ${holder.pid}) to finish`;
}

/** Narrows the parsed lock file to a holder record. */
function isHolderRecord(value: unknown): value is HolderRecord {
  return (
    isObject(value) &&
    typeof value['command'] === 'string' &&
    typeof value['dir'] === 'string' &&
    typeof value['pid'] === 'number' &&
    typeof value['startedAt'] === 'string' &&
    typeof value['token'] === 'string'
  );
}

/**
 * Reports whether an ancestor nmr process holds the lock. An inherited token counts only while the lock file still
 * contains it: A process that outlived the run that spawned it must not skip a lock that someone else now holds.
 */
async function isUnderAncestorHold(lockDir: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const inheritedToken = env[LOCK_TOKEN_ENV_VAR];
  if (inheritedToken === undefined || inheritedToken === '') {
    return false;
  }

  const state = await readLockState(path.join(lockDir, LOCK_FILE));
  return state?.holder?.token === inheritedToken;
}

/** Reports whether a holder's process has exited. A process that this one may not signal still exists. */
function isProcessGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return readErrorCode(error) === 'ESRCH';
  }
}

/**
 * Reports whether the observed lock no longer has a live holder. A file that does not parse may be mid-write, so only
 * its age can make it stale.
 */
function isStale(state: LockState, staleAfterMs: number): boolean {
  if (Date.now() - state.mtimeMs > staleAfterMs) {
    return true;
  }

  return state.holder !== undefined && isProcessGone(state.holder.pid);
}

/** Parses the lock file's content, or returns `undefined` when it is not a holder record. */
function parseHolder(content: string): HolderRecord | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return isHolderRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Returns the `code` of a Node system error, or `undefined` for anything else. */
function readErrorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

/** Reads the lock file, or returns `undefined` when it does not exist. */
async function readLockState(lockPath: string): Promise<LockState | undefined> {
  try {
    const [content, stats] = await Promise.all([fs.readFile(lockPath, 'utf8'), fs.stat(lockPath)]);
    return { holder: parseHolder(content), mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}

/**
 * Removes a stale lock under the reclaim guard, after confirming that the lock is still the stale one that was
 * observed. A waiter that cannot take the guard returns, and polls again.
 */
async function reclaimStaleLock(options: {
  lockDir: string;
  lockPath: string;
  observed: LockState;
  staleAfterMs: number;
}): Promise<void> {
  const { lockDir, lockPath, observed, staleAfterMs } = options;
  const guardPath = path.join(lockDir, RECLAIM_GUARD);

  try {
    await fs.mkdir(guardPath);
  } catch {
    await removeAbandonedGuard(guardPath);
    return;
  }

  try {
    const current = await readLockState(lockPath);
    if (current !== undefined && current.holder?.token === observed.holder?.token && isStale(current, staleAfterMs)) {
      await fs.rm(lockPath, { force: true });
    }
  } finally {
    await fs.rm(guardPath, { force: true, recursive: true });
  }
}

/** Sets the lock file's mtime to now, so that waiters see a live holder. A failed refresh waits for the next one. */
async function refreshMtime(lockPath: string): Promise<void> {
  const now = new Date();
  try {
    await fs.utimes(lockPath, now, now);
  } catch {
    // The file was removed by a release or a reclaim.
  }
}

/** Removes a reclaim guard whose owner stopped before removing it. */
async function removeAbandonedGuard(guardPath: string): Promise<void> {
  try {
    const stats = await fs.stat(guardPath);
    if (Date.now() - stats.mtimeMs > RECLAIM_GUARD_STALE_AFTER_MS) {
      await fs.rm(guardPath, { force: true, recursive: true });
    }
  } catch {
    // The guard was removed between the failed `mkdir` and the `stat`.
  }
}

/** Warns that the run proceeds unserialized because the lock directory cannot be written. */
function reportUnwritableDir(lockDir: string, error: unknown, stderr: Writable): void {
  const code = readErrorCode(error) ?? 'unknown error';
  stderr.write(
    `nmr: running without the machine lock: cannot write ${lockDir} (${code}). ` +
      `Grant write access to it, or set ${LOCK_DIR_ENV_VAR} to a writable directory.\n`,
  );
}

// endregion | Helpers
