/* eslint-disable unicorn/consistent-function-scoping -- `removeStaleCheckouts` is sent to the host as source, so every helper that it calls must be inside it. */
import { quoteForShell } from '../helpers/quoteForShell.ts';

/** The file whose mtime records a checkout's last use, relative to the checkout. */
export const CHECKOUT_STAMP_PATH = '.git/nmr-delegate-used';

/** What the removal needs, sent to it as JSON. */
export interface CheckoutRemovalParams {
  /** The directory that contains one directory per checkout key, relative to the host's home directory. */
  checkoutsDir: string;
  /** The checkout's lock file, relative to the checkout. */
  lockPath: string;
  /** The key of the delegation's own checkout, which is never removed. */
  ownKey: string;
  /** Age past which an unused checkout is removed, or `null` to keep every checkout. */
  removeAfterMs: number | null;
  /** Age at which an unrefreshed lock file is abandoned. */
  staleAfterMs: number;
  /** The file whose mtime records the checkout's last use, relative to the checkout. */
  stampPath: string;
}

/** Composes the shell command that runs `removeStaleCheckouts` on the host. */
export function composeCheckoutRemovalScript(params: CheckoutRemovalParams): string {
  const source = `(${removeStaleCheckouts.toString()})(JSON.parse(process.argv[1]));`;

  return `node -e ${quoteForShell(source)} ${quoteForShell(JSON.stringify(params))}`;
}

/**
 * Runs on the host and removes every checkout other than the delegation's own that has not been used for longer than
 * `removeAfterMs` and whose lock does not have a live holder. A checkout's last use is the newest mtime of its stamp,
 * `.git/index`, and `.git/HEAD`, so that a checkout made by an nmr that does not write the stamp still has one.
 *
 * Each checkout is renamed into `.removing/` at once, so that a delegation that starts later creates a fresh one, and
 * a detached `rm` then deletes `.removing/`, so that the delegation does not wait for it. An entry that cannot be
 * read or moved is skipped. It is sent as source, so it refers to nothing outside its own body.
 *
 * @internal
 */
export function removeStaleCheckouts(params: CheckoutRemovalParams): void {
  const fs = process.getBuiltinModule('node:fs');
  const childProcess = process.getBuiltinModule('node:child_process');
  const crypto = process.getBuiltinModule('node:crypto');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');

  const removeAfterMs = params.removeAfterMs;
  if (removeAfterMs === null) return;

  const rootDir = path.join(os.homedir(), params.checkoutsDir);
  const removingDir = path.join(rootDir, '.removing');
  const now = Date.now();

  for (const key of readNames(rootDir)) {
    if (key.startsWith('.') || key === params.ownKey) continue;
    const keyDir = path.join(rootDir, key);
    const checkouts = readNames(keyDir);
    if (checkouts.length !== 1) continue;
    const checkoutDir = path.join(keyDir, checkouts[0] ?? '');

    const lastUsedMs = readLastUsedMs(checkoutDir);
    if (lastUsedMs === undefined || now - lastUsedMs <= removeAfterMs) continue;
    if (isLockHeld(path.join(checkoutDir, params.lockPath))) continue;

    try {
      fs.mkdirSync(removingDir, { recursive: true });
      fs.renameSync(keyDir, path.join(removingDir, crypto.randomUUID()));
    } catch {
      // Another delegation moved it first, or the directory cannot be moved.
    }
  }

  if (fs.existsSync(removingDir)) {
    childProcess.spawn('rm', ['-rf', removingDir], { detached: true, stdio: 'ignore' }).unref();
  }

  /** Reports whether a lock file exists and has a live holder, by the checkout lock's own staleness rules. */
  function isLockHeld(lockPath: string): boolean {
    let content: string;
    let mtimeMs: number;
    try {
      content = fs.readFileSync(lockPath, 'utf8');
      ({ mtimeMs } = fs.statSync(lockPath));
    } catch {
      return false;
    }
    if (Date.now() - mtimeMs > params.staleAfterMs) return false;

    const pid = readHolderPid(content);
    return pid === undefined || !isProcessGone(pid);
  }

  /** Reports whether a process has exited. A process that this one may not signal still exists. */
  function isProcessGone(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
    }
  }

  /** Returns the holder's pid from a lock file's content, or `undefined` when the content does not parse. */
  function readHolderPid(content: string): number | undefined {
    try {
      const value: unknown = JSON.parse(content);
      if (typeof value !== 'object' || value === null || !('pid' in value)) return undefined;
      return typeof value.pid === 'number' ? value.pid : undefined;
    } catch {
      return undefined;
    }
  }

  /** Returns the newest mtime of the files that record a checkout's use, or `undefined` when none exists. */
  function readLastUsedMs(checkoutDir: string): number | undefined {
    let newestMs: number | undefined;
    for (const file of [params.stampPath, '.git/index', '.git/HEAD']) {
      try {
        newestMs = Math.max(newestMs ?? 0, fs.statSync(path.join(checkoutDir, file)).mtimeMs);
      } catch {
        // The file does not exist.
      }
    }
    return newestMs;
  }

  /** Lists a directory's entries, or returns none when it cannot be read. */
  function readNames(dir: string): string[] {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  }
}
