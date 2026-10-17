import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { addSubmodule } from '../commands/test-utils/addSubmodule.ts';
import { composeRunScript, createSnapshot, runRemotely, wrapRemoteScript } from '../remote-run.ts';
import { createFakeRemote, type FakeRemote } from '../test-utils/fake-remote.ts';

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

    expect(result.outcome).toStrictEqual({ ok: true, exitCode: 0 });
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

    expect(result.outcome).toStrictEqual({ ok: true, exitCode: 3 });
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

  it('stops the command on the host when the connection closes', async () => {
    const pidFile = workspace.resolve('run.pid');
    const script = wrapRemoteScript(composeRunScript({ nmrArgs: ['test'], remoteEnv: {}, runDir: repo }));
    const env = remote.buildEnv({ FAKE_RUN_PIDFILE: pidFile, FAKE_RUN_SLEEP: '30' });
    const child = spawn('/bin/sh', ['-c', script], {
      env: { ...env, SHELL: env['FAKE_LOGIN_SHELL'] },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '');
    const runPid = Number(fs.readFileSync(pidFile, 'utf8').trim());

    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
    await waitFor(() => !isAlive(runPid));

    expect(isAlive(runPid)).toBe(false);
  });

  /** Snapshots the repo and delegates `nmrArgs` to `host`, capturing both streams. */
  async function delegate(nmrArgs: string[], extraEnv: Record<string, string> = {}, cwd = repo, host = 'box') {
    const env = remote.buildEnv(extraEnv);
    const snapshot = createSnapshot(cwd, env);
    if (!snapshot.ok) throw new Error(snapshot.reason);
    const stdout = captureStream();
    const stderr = captureStream();

    const outcome = await runRemotely({
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

describe(createSnapshot, () => {
  let workspace: TempTree;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-snapshot-' }));
  });

  it('yields the same commit for the same tree', () => {
    workspace.writeAll({ 'repo/a.txt': 'a\n' });
    const repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
    workspace.write('repo/b.txt', 'b\n');

    const first = createSnapshot(repo, process.env);
    const second = createSnapshot(repo, process.env);

    expect(first.ok && second.ok && first.sha === second.sha).toBe(true);
  });

  it('refuses a repository with a submodule', () => {
    const tree = disposeOnTestFinished(createTempTree({ 'a.txt': 'a\n' }, { prefix: 'nmr-snapshot-super-' }));
    const repo = fs.realpathSync(tree.dir);
    initRepo(repo);
    addSubmodule(tree, 'vendored');

    expect(createSnapshot(repo, process.env)).toMatchObject({ ok: false, isUnsupported: true });
  });

  it('refuses a working tree containing a nested repository', () => {
    workspace.writeAll({ 'repo/a.txt': 'a\n' });
    const repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
    workspace.write('repo/nested/b.txt', 'b\n');
    initRepo(path.join(repo, 'nested'));

    expect(createSnapshot(repo, process.env)).toMatchObject({ ok: false, isUnsupported: true });
  });
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

/** Initializes a repository at `dir` and commits everything in it. */
function initRepo(dir: string): void {
  runGit(dir, ['init', '--quiet', '--initial-branch=main']);
  runGit(dir, ['config', 'user.email', 'fixture@example.com']);
  runGit(dir, ['config', 'user.name', 'Fixture']);
  runGit(dir, ['config', 'commit.gpgsign', 'false']);
  runGit(dir, ['add', '--all']);
  runGit(dir, ['commit', '--quiet', '--message', 'initial']);
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
