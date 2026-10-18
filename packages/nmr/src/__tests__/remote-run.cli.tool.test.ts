import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEBUG_ENV_VAR, NO_CACHE_ENV_VAR, TREE_SNAPSHOT_ENV_VAR } from '../check-cache.ts';
import { NO_LOCK_ENV_VAR } from '../machine-lock.ts';
import { OUTPUT_STYLE_ENV_VAR } from '../output-style.ts';
import { DELEGATE_ENV_VAR } from '../remote-run.ts';
import { runCli } from '../runCli.ts';
import { createFakeRemote, type FakeRemote } from '../test-utils/fake-remote.ts';
import { initRepo } from '../test-utils/initRepo.ts';

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
    const result = await runNmr(['--delegate-to', 'box', 'test'], { [OUTPUT_STYLE_ENV_VAR]: 'plain' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('remote stdout');
    expect(result.stdout).toMatch(/^PASS repo: test: passed on box in /m);
    expect(result.stdout).not.toContain('ran-here');
  });

  it("forwards nmr's own flags and the command's arguments", async () => {
    await runNmr(['--delegate-to=box', '-F', 'core', '--no-cache', 'test', 'a b']);

    expect(remote.readPnpmLog()).toContain('args=--no-delegate --filter core --no-cache test a b');
  });

  it("passes nmr's own variables that the host needs, and withholds those that describe this machine", async () => {
    await runNmr(['--delegate-to', 'box', 'test'], {
      [DEBUG_ENV_VAR]: '1',
      [NO_CACHE_ENV_VAR]: '1',
      [NO_LOCK_ENV_VAR]: '1',
      [TREE_SNAPSHOT_ENV_VAR]: 'tree head',
    });

    expect(remote.readPnpmLog()).toContain('env=no-cache:1 debug:1 run-id:set snapshot: lock-token: no-lock:unset');
  });

  it('delegates by default when NMR_DELEGATE names a host', async () => {
    const result = await runNmr(['test'], { [DELEGATE_ENV_VAR]: 'box', [OUTPUT_STYLE_ENV_VAR]: 'plain' });

    expect(result.stdout).toContain('passed on box');
  });

  it("exits with the command's status on the host", async () => {
    const result = await runNmr(['--delegate-to', 'box', 'test'], {
      FAKE_RUN_STATUS: '3',
      [OUTPUT_STYLE_ENV_VAR]: 'plain',
    });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toMatch(/^FAIL repo: test: failed on box in .* \(exit 3\)$/m);
  });

  it('exits 255 and names the phase when the host cannot be reached', async () => {
    const result = await runNmr(['--delegate-to', 'unreachable', 'test'], { [OUTPUT_STYLE_ENV_VAR]: 'plain' });

    expect(result.exitCode).toBe(255);
    expect(result.stdout).toContain('(exit 255) — could not prepare unreachable');
    expect(result.stderr).toContain('Connection refused');
  });

  describe('with several hosts', () => {
    it('runs on a free host rather than a busy one, and notes what each probe found', async () => {
      remote.addHost('busy');
      remote.addHost('spare');
      workspace.write('fake-home/hosts/busy/nmr-lock/heavy.lock', JSON.stringify({ pid: process.pid }));

      const result = await runNmr(['--delegate-to', 'busy,spare', 'test'], {
        [DEBUG_ENV_VAR]: '1',
        [OUTPUT_STYLE_ENV_VAR]: 'plain',
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^PASS repo: test: passed on spare in /m);
      expect(result.stderr).toContain('busy is busy');
      expect(result.stderr).toContain('spare is free');
      expect(remote.readSshLog()).toStrictEqual(expect.arrayContaining(['busy probe', 'spare probe']));
    });

    it('does not probe a single host', async () => {
      await runNmr(['--delegate-to', 'box', 'test']);

      expect(remote.readSshLog()).not.toContainEqual(expect.stringMatching(/ probe$/));
    });

    it('fails the delegation, rather than running here, when no host can be reached', async () => {
      const result = await runNmr(['--delegate-to', 'unreachable-1,unreachable-2', 'test'], {
        [OUTPUT_STYLE_ENV_VAR]: 'plain',
      });

      expect(result.exitCode).toBe(255);
      expect(result.stdout).toContain('(exit 255) — could not prepare unreachable-1');
      expect(result.stdout).not.toContain('ran-here');
    });
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

// endregion | Helpers
