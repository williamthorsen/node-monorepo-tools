/** What the host probe needs, sent to it as JSON. */
export interface HostProbeParams {
  /** The checkout's lock file, relative to the host's home directory. */
  checkoutLockPath: string;
  /** The variable that overrides the machine lock's directory. */
  lockDirEnvVar: string;
  /** The machine lock's file name in its directory. */
  machineLockFile: string;
  /** Age at which an unrefreshed lock file is abandoned. */
  staleAfterMs: number;
}

/**
 * Runs on the host and prints, as one JSON line, whether a delegation started now would wait: whether the machine
 * lock or the checkout's lock has a live holder. It applies the locks' own staleness rules and changes nothing. It is
 * sent as source, so it refers to nothing outside its own body.
 *
 * The machine lock's directory is resolved as the host's nmr resolves it, from the environment that `ssh` gives the
 * session.
 *
 * @internal
 */
export function probeHostLocks(params: HostProbeParams): void {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');

  const lockDir = resolveLockDir();
  const lockPaths = [path.join(lockDir, params.machineLockFile), path.join(os.homedir(), params.checkoutLockPath)];

  process.stdout.write(`${JSON.stringify({ busy: lockPaths.some(isHeld) })}\n`);

  /** Reports whether a lock file exists and has a live holder. A file that does not parse may be mid-write. */
  function isHeld(lockPath: string): boolean {
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

  /** Returns the machine lock's directory: the override, otherwise one per user under `/tmp`. */
  function resolveLockDir(): string {
    const override = process.env[params.lockDirEnvVar];
    if (override !== undefined && override !== '') return override;

    const uid = process.getuid?.();
    return uid === undefined ? path.join(os.tmpdir(), 'nmr') : `/tmp/nmr-${uid}`;
  }
}
