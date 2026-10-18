import fs from 'node:fs';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { NO_CACHE_ENV_VAR } from '../check-cache.ts';
import { OUTPUT_STYLE_ENV_VAR } from '../output-style.ts';
import { runCli } from '../runCli.ts';
import { createFakeRemote, type FakeRemote } from '../test-utils/fake-remote.ts';
import { initRepo } from '../test-utils/initRepo.ts';

describe('a delegation behind the check-result cache', () => {
  let workspace: TempTree;
  let remote: FakeRemote;
  let repo: string;

  beforeEach(() => {
    workspace = disposeOnTestFinished(createTempTree({}, { prefix: 'nmr-delegate-cache-' }));
    remote = createFakeRemote(workspace);
    workspace.writeAll({
      'repo/.config/nmr.config.ts': `export default ${JSON.stringify({ rootScripts: { test: 'echo ran-here' } })};\n`,
      'repo/.gitignore': 'node_modules/\n',
      // The install fingerprint that the gate reads; without it, the cache does not apply.
      'repo/node_modules/.modules.yaml': 'hoistPattern:\n  - "types"\n',
      'repo/node_modules/.pnpm/lock.yaml': 'lockfileVersion: "9.0"\n',
      'repo/package.json': '{ "name": "repo", "private": true }\n',
      'repo/pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    });
    repo = fs.realpathSync(workspace.resolve('repo'));
    initRepo(repo);
  });

  it('recalls a pass earned here without contacting the host', async () => {
    await runNmr(['--no-delegate', 'test']);

    const result = await runNmr(['--delegate', 'box', 'test']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on this tree/m);
    expect(remote.readPnpmLog()).toStrictEqual([]);
  });

  it('recalls a pass earned on the host for a delegation to that host', async () => {
    await runNmr(['--delegate', 'box', 'test']);

    const result = await runNmr(['--delegate', 'box', 'test']);

    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on box/m);
    expect(countRemoteRuns()).toBe(1);
  });

  it('does not recall a pass earned on another host', async () => {
    await runNmr(['--delegate', 'box', 'test']);

    const result = await runNmr(['--delegate', 'other', 'test']);

    expect(result.stdout).toMatch(/^PASS repo: test: passed on other in /m);
    expect(countRemoteRuns()).toBe(2);
  });

  it('does not recall a pass earned on a host for a run here', async () => {
    await runNmr(['--delegate', 'box', 'test']);

    const result = await runNmr(['--no-delegate', 'test']);

    expect(result.stdout).toContain('ran-here');
  });

  it("prints the host's transcript under --log, naming the host", async () => {
    await runNmr(['--delegate', 'box', 'test']);

    const result = await runNmr(['--log', 'test']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^repo: test — recorded .* on box$/m);
    expect(result.stdout).toContain('remote stdout');
  });

  it.each([
    ['--no-cache', ['--delegate', 'box', '--no-cache', 'test'], {}],
    ['NMR_NO_CACHE=1', ['--delegate', 'box', 'test'], { [NO_CACHE_ENV_VAR]: '1' }],
  ])('reaches the host under %s although a pass is recorded', async (_label, args, extraEnv) => {
    await runNmr(['--no-delegate', 'test']);

    const result = await runNmr(args, extraEnv);

    expect(result.stdout).toMatch(/^PASS repo: test: passed on box in /m);
    expect(countRemoteRuns()).toBe(1);
  });

  it('keeps a pass earned here when the host passes the same tree', async () => {
    await runNmr(['--no-delegate', 'test']);
    await runNmr(['--delegate', 'box', '--no-cache', 'test']);

    const result = await runNmr(['--no-delegate', 'test']);

    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on this tree/m);
  });

  it('reports an unknown command here without contacting the host', async () => {
    const result = await runNmr(['--delegate', 'box', 'ghost']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command: ghost');
    expect(remote.readPnpmLog()).toStrictEqual([]);
  });

  /** Counts the commands that the fake host ran, as distinct from its installs. */
  function countRemoteRuns(): number {
    return remote.readPnpmLog().filter((line) => line.startsWith('args=')).length;
  }

  /** Runs the CLI in-process in the repo, with `ssh` and `pnpm` resolving to the fakes and plain output. */
  async function runNmr(args: string[], extraEnv: Record<string, string> = {}) {
    const stdout = captureStream();
    const stderr = captureStream();

    const { exitCode } = await runCli({
      args,
      cwd: repo,
      env: remote.buildEnv({ [OUTPUT_STYLE_ENV_VAR]: 'plain', ...extraEnv }),
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
