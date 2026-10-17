import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { quoteForShell } from '../helpers/quoteForShell.ts';
import { OUTPUT_STYLE_ENV_VAR } from '../output-style.ts';
import { DELEGATE_ENV_VAR, deriveCheckoutPath, runRemotely, wrapRemoteScript } from '../remote-run.ts';
import { composeSessionScript } from '../remote-session.ts';
import { createSnapshot } from '../remote-snapshot.ts';
import { runCli } from '../runCli.ts';
import { createFakeRemote, type FakeRemote } from '../test-utils/fake-remote.ts';
import { initRepo } from '../test-utils/initRepo.ts';

describe('a delegated run on a fake host', () => {
  let workspace: TempTree;
  let remote: FakeRemote;
  let repo: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-remote-run-' }));
    remote = createFakeRemote(workspace);
    repo = scaffoldRepo();
  });

  it('runs against the working tree, uncommitted and untracked changes included, and streams its output', async () => {
    workspace.write('repo/probe.txt', 'edited\n');
    workspace.write('repo/untracked.txt', 'new\n');
    workspace.write('repo/ignored.log', 'ignored\n');

    const result = await delegate(['test', "it's"]);

    expect(result.outcome).toStrictEqual({ ok: true, exitCode: 0, waitedMs: 0 });
    expect(result.stdout).toBe('remote stdout\n');
    expect(result.stderr).toBe('remote stderr\n');
    const log = remote.readPnpmLog();
    expect(log).toContain('install install --frozen-lockfile');
    expect(log).toContain("args=--no-delegate test it's");
    expect(log).toContain('style=plain');
    expect(log).toContain('probe=edited');
    expect(readLogged(log, 'files')).toContain('untracked.txt');
    expect(readLogged(log, 'files')).not.toContain('ignored.log');
  });

  it("returns the command's own exit status", async () => {
    const result = await delegate(['test'], { FAKE_RUN_STATUS: '3' });

    expect(result.outcome).toStrictEqual({ ok: true, exitCode: 3, waitedMs: 0 });
  });

  it('runs from the directory that corresponds to the local one', async () => {
    const packageDir = workspace.mkdir('repo/packages/core');

    await delegate(['test'], {}, packageDir);

    expect(readLogged(remote.readPnpmLog(), 'cwd')).toMatch(/\/repo\/packages\/core$/);
  });

  it('removes on the host a file that was removed locally since the last run', async () => {
    workspace.write('repo/transient.txt', 'here\n');
    await delegate(['test']);
    fs.rmSync(path.join(repo, 'transient.txt'));

    await delegate(['test']);

    const fileLines = remote.readPnpmLog().filter((line) => line.startsWith('files='));
    expect(fileLines[0]).toContain('transient.txt');
    expect(fileLines[1]).not.toContain('transient.txt');
  });

  it('leaves the local index, refs, and stash unchanged', async () => {
    workspace.write('repo/probe.txt', 'staged\n');
    runGit(repo, ['add', 'probe.txt']);
    workspace.write('repo/probe.txt', 'unstaged\n');
    const before = readRepoState(repo);

    await delegate(['test']);

    expect(readRepoState(repo)).toStrictEqual(before);
  });

  it('names the phase that failed', async () => {
    const unreachable = await delegate(['test'], {}, repo, 'unreachable');
    const install = await delegate(['test'], { FAKE_INSTALL_STATUS: '1' });
    const missingPnpm = await delegate(['test'], { FAKE_INSTALL_STATUS: '127' });

    expect(unreachable.outcome).toMatchObject({
      ok: false,
      phase: 'prepare',
      message: 'could not prepare unreachable',
    });
    expect(install.outcome).toMatchObject({ ok: false, phase: 'install', message: 'could not install on box' });
    expect(missingPnpm.outcome).toMatchObject({
      ok: false,
      phase: 'install',
      message: expect.stringContaining('PATH'),
    });
  });

  it("pushes without running the repository's pre-push hook", async () => {
    const hookLog = workspace.resolve('hook.log');
    fs.chmodSync(workspace.write('repo/.git/hooks/pre-push', `#!/bin/sh\necho ran >> ${hookLog}\nexit 1\n`), 0o755);

    const result = await delegate(['test']);

    expect(result.outcome).toStrictEqual({ ok: true, exitCode: 0, waitedMs: 0 });
    expect(fs.existsSync(hookLog)).toBe(false);
  });

  it("reports the command's own exit 255 as its status", async () => {
    const result = await delegate(['test'], { FAKE_RUN_STATUS: '255' });

    expect(result.outcome).toStrictEqual({ ok: true, exitCode: 255, waitedMs: 0 });
  });

  it('reports a connection that drops during the run', async () => {
    const result = await delegate(['test'], {}, repo, 'dropping');

    expect(result.outcome).toMatchObject({ ok: false, phase: 'run', message: 'lost connection to dropping' });
  });

  it("reads and removes the status file of the command's own 255", async () => {
    await delegate(['test'], { FAKE_RUN_STATUS: '255' });

    expect(
      fs.readdirSync(path.join(checkoutDir(), '.git')).filter((name) => name.startsWith('nmr-run-status')),
    ).toStrictEqual([]);
  });

  it('stops the command on the host and releases the lock when the connection closes', async () => {
    await delegate(['test']);
    const pidFile = workspace.resolve('run.pid');
    const session = startSession({ FAKE_RUN_PIDFILE: pidFile, FAKE_RUN_SLEEP: '30' });
    await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '');
    const runPid = Number(fs.readFileSync(pidFile, 'utf8').trim());

    await session.stop();
    await waitFor(() => !isAlive(runPid));

    expect(isAlive(runPid)).toBe(false);
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it('stops the install on the host and releases the lock when the connection closes', async () => {
    await delegate(['test']);
    const pidFile = workspace.resolve('install.pid');
    const session = startSession({ FAKE_INSTALL_PIDFILE: pidFile, FAKE_INSTALL_SLEEP: '30' });
    await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '');
    const installPid = Number(fs.readFileSync(pidFile, 'utf8').trim());

    await session.stop();
    await waitFor(() => !isAlive(installPid));

    expect(isAlive(installPid)).toBe(false);
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it('runs a second delegation from the same tree after the first, reporting the wait', async () => {
    const pidFile = workspace.resolve('run.pid');
    const first = delegate(['test'], { FAKE_RUN_PIDFILE: pidFile, FAKE_RUN_SLEEP: '2' });
    await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '');

    const second = await delegate(['test']);

    expect((await first).outcome).toMatchObject({ ok: true, exitCode: 0 });
    expect(second.outcome).toMatchObject({ ok: true, exitCode: 0 });
    expect(second.outcome.waitedMs).toBeGreaterThan(0);
    expect(second.stderr).toContain(`nmr: waiting for test in ${repo} (pid ${process.pid}) to finish on box\n`);
    const phases = remote.readPnpmLog().filter((line) => line.startsWith('install') || line.startsWith('args='));
    expect(phases.map((line) => line.split(' ', 1)[0])).toStrictEqual([
      'install',
      'args=--no-delegate',
      'install',
      'args=--no-delegate',
    ]);
  });

  it('reclaims at once a lock whose holder has exited', async () => {
    await delegate(['test']);
    workspace.writeJson(path.relative(workspace.resolve('.'), lockPath()), createLockFile(readExitedPid()));

    const result = await delegate(['test']);

    expect(result.outcome).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.stderr).not.toContain('waiting');
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it('stops waiting, leaving the holder its lock, when the connection closes', async () => {
    await delegate(['test']);
    workspace.writeJson(path.relative(workspace.resolve('.'), lockPath()), createLockFile(process.pid));
    const session = startSession();
    await waitFor(() => session.readStderr().includes('"kind":"waiting"'));

    await session.stop();

    expect(remote.readPnpmLog().filter((line) => line.startsWith('install'))).toHaveLength(1);
    expect(fs.existsSync(lockPath())).toBe(true);
  });

  /** Returns the host's checkout of the repo, which the fake home contains. */
  function checkoutDir(): string {
    return path.join(remote.home, deriveCheckoutPath(os.hostname(), repo));
  }

  /** Returns a lock file's content for a holder whose host pid is `pid`, refreshed now. */
  function createLockFile(pid: number) {
    return { command: 'ci', dir: repo, localPid: pid, pid, startedAt: new Date().toISOString(), token: 'planted' };
  }

  /** Returns the path of the checkout's lock file. */
  function lockPath(): string {
    return path.join(checkoutDir(), '.git', 'nmr-delegate.lock');
  }

  /**
   * Starts a host session for the repo's working tree as `ssh` would, with its stdin open, and returns a way to read
   * its stderr and to close its stdin as a closing connection does.
   */
  function startSession(extraEnv: Record<string, string> = {}) {
    const env = remote.buildEnv(extraEnv);
    const snapshot = createSnapshot(repo, env);
    if (!snapshot.ok) throw new Error(snapshot.reason);
    const script = composeSessionScript({
      checkoutDir: quoteForShell(checkoutDir()),
      params: {
        holder: { command: 'test', dir: repo, pid: process.pid },
        marker: '__NMR_DELEGATE_test__',
        nmrArgs: ['test'],
        remoteEnv: {},
        rootDir: '.',
        runDir: '.',
        sha: snapshot.sha,
        statusFile: '.git/nmr-run-status-test',
      },
    });
    const child = spawn('/bin/sh', ['-c', wrapRemoteScript(script)], {
      env: { ...env, HOME: remote.home, SHELL: env['FAKE_LOGIN_SHELL'] },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const stderr = captureStream();
    child.stderr.pipe(stderr.stream);
    const closed = new Promise((resolve) => child.on('close', resolve));

    return {
      readStderr: stderr.read,
      async stop() {
        child.stdin.end();
        await closed;
      },
    };
  }

  /** Snapshots the repo and delegates `nmrArgs` to `host`, capturing both streams. */
  async function delegate(nmrArgs: string[], extraEnv: Record<string, string> = {}, cwd = repo, host = 'box') {
    const env = remote.buildEnv(extraEnv);
    const snapshot = createSnapshot(cwd, env);
    if (!snapshot.ok) throw new Error(snapshot.reason);
    const stdout = captureStream();
    const stderr = captureStream();

    const outcome = await runRemotely({
      command: 'test',
      cwd,
      env,
      host,
      monorepoRoot: repo,
      nmrArgs,
      remoteEnv: { NMR_OUTPUT_STYLE: 'plain' },
      snapshot,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    return { outcome, stderr: stderr.read(), stdout: stdout.read() };
  }

  /** Writes and commits a repo whose `probe.txt` reads `committed` and whose `.gitignore` ignores logs. */
  function scaffoldRepo(): string {
    workspace.writeAll({
      'repo/.gitignore': '*.log\nnode_modules/\n',
      'repo/package.json': '{ "name": "repo", "private": true }\n',
      'repo/probe.txt': 'committed\n',
    });
    const repoDir = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repoDir);

    return repoDir;
  }
});

describe('nmr with a delegation host', () => {
  let workspace: TempTree;
  let remote: FakeRemote;
  let repo: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-delegate-cli-' }));
    remote = createFakeRemote(workspace);
    workspace.writeAll({
      'repo/.config/nmr.config.ts': `export default ${JSON.stringify({ rootScripts: { test: 'echo ran-here' } })};\n`,
      'repo/.gitignore': 'node_modules/\n',
      'repo/package.json': '{ "name": "repo", "private": true }\n',
      'repo/pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    });
    repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
  });

  it('runs the command on the host and reports a verdict that names it', async () => {
    const result = await runNmr(['--delegate', 'box', 'test'], { [OUTPUT_STYLE_ENV_VAR]: 'plain' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('remote stdout');
    expect(result.stdout).toMatch(/^PASS repo: test: passed on box in /m);
    expect(result.stdout).not.toContain('ran-here');
  });

  it("forwards nmr's own flags and the command's arguments", async () => {
    await runNmr(['--delegate=box', '-F', 'core', '--no-cache', 'test', 'a b']);

    expect(remote.readPnpmLog()).toContain('args=--no-delegate --filter core --no-cache test a b');
  });

  it('delegates by default when NMR_DELEGATE names a host', async () => {
    const result = await runNmr(['test'], { [DELEGATE_ENV_VAR]: 'box', [OUTPUT_STYLE_ENV_VAR]: 'plain' });

    expect(result.stdout).toContain('passed on box');
  });

  it("exits with the command's status on the host", async () => {
    const result = await runNmr(['--delegate', 'box', 'test'], {
      FAKE_RUN_STATUS: '3',
      [OUTPUT_STYLE_ENV_VAR]: 'plain',
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toMatch(/^FAIL repo: test: failed on box in .* \(exit 3\)$/m);
  });

  it('exits 255 and names the phase when the host cannot be reached', async () => {
    const result = await runNmr(['--delegate', 'unreachable', 'test'], { [OUTPUT_STYLE_ENV_VAR]: 'plain' });

    expect(result.exitCode).toBe(255);
    expect(result.stdout).toContain('(exit 255) — could not prepare unreachable');
    expect(result.stderr).toContain('Connection refused');
  });

  it('runs here, saying why, when NMR_DELEGATE meets a tree that cannot be snapshotted', async () => {
    workspace.write('repo/nested/a.txt', 'a\n');
    initRepo(path.join(repo, 'nested'));

    const result = await runNmr(['test'], { [DELEGATE_ENV_VAR]: 'box' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ran-here');
    expect(result.stderr).toContain('running test here rather than on box');
  });

  /** Runs the CLI in-process in the repo, with `ssh` and `pnpm` resolving to the fakes. */
  async function runNmr(args: string[], extraEnv: Record<string, string> = {}) {
    const stdout = captureStream();
    const stderr = captureStream();

    const { exitCode } = await runCli({
      args,
      cwd: repo,
      env: remote.buildEnv(extraEnv),
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    return { exitCode, stderr: stderr.read(), stdout: stdout.read() };
  }
});

// region | Helpers

/** Returns a writable stream and a reader of everything written to it. */
function captureStream(): { read: () => string; stream: PassThrough } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  return { read: () => Buffer.concat(chunks).toString('utf8'), stream };
}

/** Reports whether a process with this pid exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Returns the value that the fake `pnpm` logged under `name`. */
function readLogged(log: readonly string[], name: string): string {
  return log.find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
}

/** Returns the pid of a process that has exited. */
function readExitedPid(): number {
  const child = spawnSync('true');
  return child.pid;
}

/** Reads everything that delegation must not change: the index file, every ref, and the stash list. */
function readRepoState(repo: string): { index: string; refs: string; stash: string; status: string } {
  return {
    index: fs.readFileSync(path.join(repo, '.git', 'index')).toString('base64'),
    refs: runGit(repo, ['for-each-ref']),
    stash: runGit(repo, ['stash', 'list']),
    status: runGit(repo, ['status', '--porcelain']),
  };
}

/** Runs git in `cwd` and returns its stdout. */
function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Polls `condition` until it holds, failing after five seconds. */
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// endregion | Helpers
