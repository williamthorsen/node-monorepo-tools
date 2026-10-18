/* eslint-disable unicorn/consistent-function-scoping -- `runHostSession` is sent to the host as source, so every helper that it calls must be inside it. */

/** The checkout's lock, which a host session holds and the lock probe reads, relative to the checkout. */
export const CHECKOUT_LOCK_PATH = '.git/nmr-delegate.lock';

/** The local delegation on whose behalf a host session runs, as a waiting session names it. */
export interface DelegationHolder {
  command: string;
  dir: string;
  pid: number;
}

/** What the host session needs, sent to it as JSON. Every directory is relative to the checkout. */
export interface HostSessionParams {
  holder: DelegationHolder;
  lockPath: string;
  /** Begins each record line on stderr; it contains a per-delegation nonce, so that a command cannot forge one. */
  marker: string;
  nmrArgs: readonly string[];
  /** The directory, created for this delegation, into which every nmr process of the run reports its passes. */
  passManifestDir: string;
  /** The variable that names the pass-manifest directory to nmr. */
  passManifestEnvVar: string;
  remoteEnv: Readonly<Record<string, string>>;
  rootDir: string;
  runDir: string;
  sha: string;
  /** Age at which an unrefreshed lock file is abandoned. */
  staleAfterMs: number;
  /** Where the session records nmr's status when it is 255, so that it can be told apart from a dropped connection. */
  statusFile: string;
}

/** A phase of the host session that can fail before the run starts. */
export type SessionPhase = 'check out' | 'install';

/**
 * A line in which the host session reports to the local side: its progress before the run starts, and the passes that
 * the run reported once it has ended.
 */
export type SessionRecord =
  | { kind: 'failed'; exitCode: number; output: string; phase: SessionPhase }
  | { kind: 'locked' }
  | { kind: 'passes'; entries: unknown[] }
  | { kind: 'run' }
  | { kind: 'waiting'; holder: DelegationHolder | undefined };

/**
 * Runs on the host, from the checkout, as the whole of a delegation after the push: takes the checkout's lock, checks
 * out the snapshot, installs, runs nmr, and reports the passes that nmr wrote to the pass manifest. It is sent as
 * source, so it refers to nothing outside its own body.
 *
 * The lock follows the machine lock's rules: A waiter reclaims it at once when the holder's pid is gone, and once the
 * holder has stopped refreshing it for a minute otherwise. When the session's stdin ends, which the local `ssh` causes
 * by exiting, the session stops its current phase's process group, releases the lock, and exits.
 *
 * @internal
 */
export function runHostSession(params: HostSessionParams): void {
  const fs = process.getBuiltinModule('node:fs');
  const childProcess = process.getBuiltinModule('node:child_process');
  const crypto = process.getBuiltinModule('node:crypto');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');

  const LOCK_PATH = params.lockPath;
  const RECLAIM_GUARD_PATH = `${params.lockPath}.reclaim`;
  const HEARTBEAT_INTERVAL_MS = 10_000;
  const POLL_INTERVAL_MS = 1_000;
  const RECLAIM_GUARD_STALE_AFTER_MS = 10_000;
  const OUTPUT_LIMIT_BYTES = 65_536;
  const COMMAND_NOT_FOUND_EXIT_CODE = 127;
  const DELEGATION_FAILURE_EXIT_CODE = 255;
  const STOP_GRACE_MS = 5_000;

  interface LockFile {
    command: string;
    dir: string;
    localPid: number;
    pid: number;
    startedAt: string;
    token: string;
  }

  const token = crypto.randomUUID();
  let isHolding = false;
  let activeChild: ReturnType<typeof childProcess.spawn> | undefined;
  let isStopping = false;

  process.on('exit', releaseLock);
  process.stdin.on('end', stop).on('error', stop).resume();

  void main();

  async function main(): Promise<void> {
    await acquireLock();
    emit({ kind: 'locked' });

    for (const args of [
      ['checkout', '--quiet', '--force', '--detach', params.sha],
      ['clean', '--force', '-d', '--quiet'],
    ]) {
      const result = await runPhase('git', args, '.', process.env);
      if (isStopping) return;
      if (result.exitCode !== 0) {
        fail('check out', result);
        return;
      }
    }

    const install = await runPhase('pnpm', ['install', '--frozen-lockfile'], params.rootDir, {
      ...process.env,
      CI: 'true',
    });
    if (isStopping) return;
    if (install.exitCode !== 0) {
      fail('install', install);
      return;
    }

    emit({ kind: 'run' });
    fs.mkdirSync(params.runDir, { recursive: true });
    // Under `.git/`, so that the entries do not become untracked files in the tree that the run hashes.
    fs.mkdirSync(params.passManifestDir, { recursive: true });
    // The next delegation's checkout does not clean `.git/`, so the session removes the manifest however it exits.
    process.on('exit', () => fs.rmSync(params.passManifestDir, { force: true, recursive: true }));
    const manifestEnv = { [params.passManifestEnvVar]: path.resolve(process.cwd(), params.passManifestDir) };
    const child = childProcess.spawn('pnpm', ['exec', 'nmr', '--no-delegate', ...params.nmrArgs], {
      cwd: params.runDir,
      detached: true,
      env: { ...process.env, ...params.remoteEnv, ...manifestEnv },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    activeChild = child;
    child.on('error', (error) => {
      process.stderr.write(`pnpm: ${error.message}\n`, () => {
        process.exit(COMMAND_NOT_FOUND_EXIT_CODE);
      });
    });
    child.on('close', (code, signal) => {
      const status = code ?? 128 + (signal === null ? 0 : os.constants.signals[signal]);
      if (status === DELEGATION_FAILURE_EXIT_CODE) {
        fs.writeFileSync(params.statusFile, `${status}\n`);
      }
      // The record is the session's last output, and a large one needs the write to finish before the exit.
      emit({ kind: 'passes', entries: readPassManifest() }, () => {
        process.exit(status);
      });
    });
  }

  /** Takes the checkout's lock, reporting each holder that it waits for. */
  async function acquireLock(): Promise<void> {
    const record: LockFile = {
      command: params.holder.command,
      dir: params.holder.dir,
      localPid: params.holder.pid,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token,
    };
    let reportedToken: string | undefined;

    for (;;) {
      try {
        fs.writeFileSync(LOCK_PATH, JSON.stringify(record), { flag: 'wx' });
        isHolding = true;
        setInterval(refreshLock, HEARTBEAT_INTERVAL_MS).unref();
        return;
      } catch (error) {
        if (readErrorCode(error) !== 'EEXIST') throw error;
      }

      const state = readLockState();
      if (state === undefined) continue;
      if (isStale(state)) {
        reclaimStaleLock(state);
        continue;
      }

      const holderToken = state.holder?.token ?? 'unreadable';
      if (holderToken !== reportedToken) {
        const holder = state.holder;
        emit({
          kind: 'waiting',
          holder: holder === undefined ? undefined : { command: holder.command, dir: holder.dir, pid: holder.localPid },
        });
        reportedToken = holderToken;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  /** Writes a record line to stderr. */
  function emit(record: SessionRecord, onWritten?: () => void): void {
    process.stderr.write(`${params.marker} ${JSON.stringify(record)}\n`, onWritten);
  }

  /** Reports a failed phase with what it printed, and exits once the record is written. */
  function fail(phase: SessionPhase, result: { exitCode: number; output: string }): void {
    // A pipe on macOS takes the write asynchronously, and exiting at once would cut a large record short.
    emit({ kind: 'failed', exitCode: result.exitCode, output: result.output, phase }, () => {
      process.exit(1);
    });
  }

  /** Narrows the parsed lock file. */
  function isLockFile(value: unknown): value is LockFile {
    if (typeof value !== 'object' || value === null) return false;
    const fields: Partial<Record<string, unknown>> = { ...value };
    return (
      typeof fields['command'] === 'string' &&
      typeof fields['dir'] === 'string' &&
      typeof fields['localPid'] === 'number' &&
      typeof fields['pid'] === 'number' &&
      typeof fields['startedAt'] === 'string' &&
      typeof fields['token'] === 'string'
    );
  }

  /** Reports whether a process has exited. A process that this one may not signal still exists. */
  function isProcessGone(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return readErrorCode(error) === 'ESRCH';
    }
  }

  /** Reports whether the observed lock no longer has a live holder. A file that does not parse may be mid-write. */
  function isStale(state: { holder: LockFile | undefined; mtimeMs: number }): boolean {
    if (Date.now() - state.mtimeMs > params.staleAfterMs) return true;
    return state.holder !== undefined && isProcessGone(state.holder.pid);
  }

  /** Returns the `code` of a Node system error, or `undefined` for anything else. */
  function readErrorCode(error: unknown): unknown {
    return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  }

  /** Reads the lock file, or returns `undefined` when it does not exist. */
  function readLockState(): { holder: LockFile | undefined; mtimeMs: number } | undefined {
    try {
      const content = fs.readFileSync(LOCK_PATH, 'utf8');
      const { mtimeMs } = fs.statSync(LOCK_PATH);
      let holder: LockFile | undefined;
      try {
        const value: unknown = JSON.parse(content);
        holder = isLockFile(value) ? value : undefined;
      } catch {
        holder = undefined;
      }
      return { holder, mtimeMs };
    } catch {
      return undefined;
    }
  }

  /** Removes a stale lock under the reclaim guard, after confirming that it is still the one observed. */
  function reclaimStaleLock(observed: { holder: LockFile | undefined; mtimeMs: number }): void {
    try {
      fs.mkdirSync(RECLAIM_GUARD_PATH);
    } catch {
      try {
        if (Date.now() - fs.statSync(RECLAIM_GUARD_PATH).mtimeMs > RECLAIM_GUARD_STALE_AFTER_MS) {
          fs.rmSync(RECLAIM_GUARD_PATH, { force: true, recursive: true });
        }
      } catch {
        // The guard was removed between the failed `mkdir` and the `stat`.
      }
      return;
    }

    try {
      const current = readLockState();
      if (current !== undefined && current.holder?.token === observed.holder?.token && isStale(current)) {
        fs.rmSync(LOCK_PATH, { force: true });
      }
    } finally {
      fs.rmSync(RECLAIM_GUARD_PATH, { force: true, recursive: true });
    }
  }

  /** Sets the lock file's mtime to now, so that waiters see a live holder. */
  function refreshLock(): void {
    const now = new Date();
    try {
      fs.utimesSync(LOCK_PATH, now, now);
    } catch {
      // The file was removed by a reclaim; the next refresh tries again.
    }
  }

  /** Parses every entry in the pass manifest, skipping a file that does not parse; the local side validates the rest. */
  function readPassManifest(): unknown[] {
    const names = fs.existsSync(params.passManifestDir) ? fs.readdirSync(params.passManifestDir) : [];
    return names.flatMap((name): unknown[] => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(params.passManifestDir, name), 'utf8'))];
      } catch {
        return [];
      }
    });
  }

  /** Removes the lock file while it still contains this session's token. */
  function releaseLock(): void {
    if (!isHolding) return;
    isHolding = false;
    if (readLockState()?.holder?.token === token) {
      fs.rmSync(LOCK_PATH, { force: true });
    }
  }

  /** Runs a phase's command in a process group of its own, capturing its output bounded at each end. */
  function runPhase(
    file: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): Promise<{ exitCode: number; output: string }> {
    const head: Buffer[] = [];
    const tail: Buffer[] = [];
    let headBytes = 0;
    let tailBytes = 0;
    let droppedBytes = 0;

    return new Promise((resolve) => {
      const child = childProcess.spawn(file, args, { cwd, detached: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
      activeChild = child;
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      child.on('error', (error) => {
        activeChild = undefined;
        resolve({ exitCode: COMMAND_NOT_FOUND_EXIT_CODE, output: `${file}: ${error.message}` });
      });
      child.on('close', (code, signal) => {
        activeChild = undefined;
        resolve({ exitCode: code ?? 128 + (signal === null ? 0 : os.constants.signals[signal]), output: readOutput() });
      });
    });

    /** Keeps the first and last `OUTPUT_LIMIT_BYTES` of the output, counting what it drops between them. */
    function capture(chunk: Buffer): void {
      const headPart = chunk.subarray(0, Math.max(0, OUTPUT_LIMIT_BYTES - headBytes));
      head.push(headPart);
      headBytes += headPart.length;
      const rest = chunk.subarray(headPart.length);
      tail.push(rest);
      tailBytes += rest.length;
      while (tailBytes > OUTPUT_LIMIT_BYTES) {
        const first = tail.shift() ?? Buffer.alloc(0);
        const dropped = Math.min(tailBytes - OUTPUT_LIMIT_BYTES, first.length);
        if (dropped < first.length) tail.unshift(first.subarray(dropped));
        tailBytes -= dropped;
        droppedBytes += dropped;
      }
    }

    /** Joins the kept output, with a marker standing in for what was dropped. */
    function readOutput(): string {
      const marker = droppedBytes > 0 ? [Buffer.from(`\n[… ${droppedBytes} bytes omitted …]\n`)] : [];
      return Buffer.concat([...head, ...marker, ...tail]).toString('utf8');
    }
  }

  /**
   * Stops the current phase's process group and exits once it has, so that a waiter cannot take the lock while the
   * group still writes to the checkout. A group that ignores the signal holds the lock for `STOP_GRACE_MS` at most.
   */
  function stop(): void {
    isStopping = true;
    const child = activeChild;
    const pid = child?.pid;
    if (child === undefined || pid === undefined) {
      process.exit(DELEGATION_FAILURE_EXIT_CODE);
    }

    child.on('close', () => process.exit(DELEGATION_FAILURE_EXIT_CODE));
    setTimeout(() => process.exit(DELEGATION_FAILURE_EXIT_CODE), STOP_GRACE_MS);
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // The group has already exited.
    }
  }
}
