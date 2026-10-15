import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { acquireMachineLock, LOCK_DIR_ENV_VAR, LOCK_TOKEN_ENV_VAR, NO_LOCK_ENV_VAR } from '../machine-lock.ts';
import type { ScriptValue } from '../resolve-scripts.ts';
import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

/** How long each fixture run holds the lock: long enough for a second run to start while it does. */
const RUN_SECONDS = 0.3;

describe('the machine lock in a run', () => {
  let workspace: TempTree;
  let lockDir: string;
  let log: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-lock-gate-' }));
    lockDir = workspace.resolve('locks');
    log = workspace.resolve('log.txt');
  });

  it('runs two heavy commands from different repositories one after the other', async () => {
    const first = scaffoldRepo('first', { test: recordRun('first') });
    const second = scaffoldRepo('second', { test: recordRun('second') });

    const firstRun = runNmr('test', first);
    await waitFor(() => fs.existsSync(path.join(lockDir, 'heavy.lock')));
    const secondRun = runNmr('test', second);
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);

    expect([firstResult.exitCode, secondResult.exitCode]).toStrictEqual([0, 0]);
    expect(readLog()).toStrictEqual(['start first', 'end first', 'start second', 'end second']);
    expect(secondResult.stderr).toContain(`nmr: waiting for test in ${first} (pid ${process.pid}) to finish`);
  });

  it('hands its token to the steps that it runs', async () => {
    const repo = scaffoldRepo('repo', { test: `echo "token=$${LOCK_TOKEN_ENV_VAR}" >> ${log}` });

    await runNmr('test', repo);

    expect(readLog()).toStrictEqual([expect.stringMatching(/^token=[\da-f-]{36}$/)]);
  });

  it('does not take the lock for a light command', async () => {
    const repo = scaffoldRepo('repo', { lint: recordRun('lint') });
    const holder = await holdLock();

    const result = await runNmr('lint', repo);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('waiting');
    await holder.release();
  });

  it('runs without waiting when the cache serves the command', async () => {
    const repo = scaffoldRepo('repo', { test: recordRun('repo') });
    await runNmr('test', repo);
    const holder = await holdLock();

    const result = await runNmr('test', repo);

    expect(result.stdout).toContain('SKIP');
    expect(result.stderr).not.toContain('waiting');
    await holder.release();
  });

  it('serves a run that waited from the pass that the holder recorded', async () => {
    const repo = scaffoldRepo('repo', { test: recordRun('repo') });
    const holder = await holdLock();

    const waitingRun = startNmr('test', repo);
    await waitFor(() => waitingRun.readStderr().includes('waiting'));
    await runNmr('--no-lock test', repo);
    await holder.release();
    const result = await waitingRun.done;

    expect(result.stdout).toContain('SKIP');
    expect(readLog()).toStrictEqual(['start repo', 'end repo']);
  });

  it.for([
    { args: '--no-lock test', case: '--no-lock', extraEnv: {} },
    { args: 'test', case: 'NMR_NO_LOCK=1', extraEnv: { [NO_LOCK_ENV_VAR]: '1' } },
  ])('runs past a held lock under $case', async ({ args, extraEnv }) => {
    const repo = scaffoldRepo('repo', { test: recordRun('repo') });
    const holder = await holdLock();

    const result = await runNmr(args, repo, extraEnv);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('waiting');
    await holder.release();
  });

  it('warns about a --no-lock written after the command name', async () => {
    const repo = scaffoldRepo('repo', { test: recordRun('repo') });

    const result = await runNmr('test --no-lock', repo);

    expect(result.stderr).toContain('--no-lock after the command name is passed to `test`');
  });

  /** Takes the lock as another nmr process would, so that a run started now has to wait. */
  function holdLock() {
    return acquireMachineLock({
      command: 'check',
      dir: '/elsewhere',
      env: {},
      lockDir,
      stderr: new PassThrough(),
    });
  }

  /** Reads the run log, one entry per line. */
  function readLog(): string[] {
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  }

  /** Returns a script that logs its start and end around a pause. */
  function recordRun(name: string): string {
    return `echo "start ${name}" >> ${log} && sleep ${RUN_SECONDS} && echo "end ${name}" >> ${log}`;
  }

  /** Runs the CLI in-process against `cwd` with the lock in the test's directory, capturing both streams. */
  function runNmr(argString: string, cwd: string, extraEnv: Record<string, string> = {}) {
    return startNmr(argString, cwd, extraEnv).done;
  }

  /** Starts the CLI as `runNmr` does, returning its completion and a reader of its stderr so far. */
  function startNmr(
    argString: string,
    cwd: string,
    extraEnv: Record<string, string> = {},
  ): { done: Promise<{ exitCode: number; stderr: string; stdout: string }>; readStderr: () => string } {
    const { [NO_LOCK_ENV_VAR]: _bypass, ...ambientEnv } = readAmbientEnv();
    const stdout = captureStream();
    const stderr = captureStream();

    const done = (async () => {
      const { exitCode } = await runCli({
        args: argString.split(' '),
        cwd,
        env: { ...ambientEnv, [LOCK_DIR_ENV_VAR]: lockDir, ...extraEnv },
        stderr: stderr.stream,
        stdout: stdout.stream,
      });

      return { exitCode, stderr: stderr.read(), stdout: stdout.read() };
    })();

    return { done, readStderr: stderr.read };
  }

  /** Writes a committed one-package workspace under `name/` whose root scripts are `rootScripts`. */
  function scaffoldRepo(name: string, rootScripts: Record<string, ScriptValue>): string {
    workspace.writeAll({
      [`${name}/.config/nmr.config.ts`]: `export default ${JSON.stringify({ rootScripts })};\n`,
      [`${name}/.gitignore`]: 'node_modules/\n',
      // The cache gate requires an install fingerprint, which pnpm's own files supply.
      [`${name}/node_modules/.modules.yaml`]: 'hoistPattern:\n  - "types"\n',
      [`${name}/node_modules/.pnpm/lock.yaml`]: 'lockfileVersion: "9.0"\n',
      [`${name}/package.json`]: JSON.stringify({ name, private: true }),
      [`${name}/pnpm-workspace.yaml`]: 'packages:\n  - "packages/*"\n',
    });

    const repo = fs.realpathSync(workspace.resolve(name));
    runGit(repo, ['init', '--initial-branch=main']);
    runGit(repo, ['config', 'user.email', 'fixture@example.com']);
    runGit(repo, ['config', 'user.name', 'Fixture']);
    runGit(repo, ['config', 'commit.gpgsign', 'false']);
    runGit(repo, ['add', '--all']);
    runGit(repo, ['commit', '--message', 'initial']);

    return repo;
  }
});

// region | Helpers

/** Returns a writable stream and a reader of everything written to it. */
function captureStream(): { read: () => string; stream: PassThrough } {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  return { read: () => output, stream };
}

/** Runs git in `cwd`, discarding its output. */
function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** Polls until `condition` holds, failing after five seconds. */
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// endregion | Helpers
