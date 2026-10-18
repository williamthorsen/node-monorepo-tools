import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { createTempTree, type TempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { beforeEach, describe, expect, it } from 'vitest';

import { NO_CACHE_ENV_VAR, PASS_MANIFEST_DIR_ENV_VAR } from '../check-cache.ts';
import { readCheckCacheEntry, removeCheckCache } from '../check-cache-entries.ts';
import { isObject } from '../helpers/type-guards.ts';
import { OUTPUT_STYLE_ENV_VAR } from '../output-style.ts';
import { runCli } from '../runCli.ts';
import { writeBuildDigest } from '../test-utils/check-cache-gate-fixtures.ts';
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

    const result = await runNmr(['--delegate-to', 'box', 'test']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on this tree/m);
    expect(remote.readPnpmLog()).toStrictEqual([]);
  });

  it('recalls a pass earned on the host for a delegation to that host', async () => {
    await runNmr(['--delegate-to', 'box', 'test']);

    const result = await runNmr(['--delegate-to', 'box', 'test']);

    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on box/m);
    expect(countRemoteRuns()).toBe(1);
  });

  it('recalls a pass earned on any host that the delegation lists', async () => {
    await runNmr(['--delegate-to', 'spare', 'test']);

    const result = await runNmr(['--delegate-to', 'box,spare', 'test']);

    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on spare/m);
    expect(countRemoteRuns()).toBe(1);
    expect(remote.readSshLog()).not.toContainEqual(expect.stringMatching(/ probe$/));
  });

  it('does not recall a pass earned on another host', async () => {
    await runNmr(['--delegate-to', 'box', 'test']);

    const result = await runNmr(['--delegate-to', 'other', 'test']);

    expect(result.stdout).toMatch(/^PASS repo: test: passed on other in /m);
    expect(countRemoteRuns()).toBe(2);
  });

  it('does not recall a pass earned on a host for a run here', async () => {
    await runNmr(['--delegate-to', 'box', 'test']);

    const result = await runNmr(['--no-delegate', 'test']);

    expect(result.stdout).toContain('ran-here');
  });

  it("prints the host's transcript under --log, naming the host", async () => {
    await runNmr(['--delegate-to', 'box', 'test']);

    const result = await runNmr(['--log', 'test']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^repo: test — recorded .* on box$/m);
    expect(result.stdout).toContain('remote stdout');
  });

  it.each([
    ['--no-cache', ['--delegate-to', 'box', '--no-cache', 'test'], {}],
    ['NMR_NO_CACHE=1', ['--delegate-to', 'box', 'test'], { [NO_CACHE_ENV_VAR]: '1' }],
  ])('reaches the host under %s although a pass is recorded', async (_label, args, extraEnv) => {
    await runNmr(['--no-delegate', 'test']);

    const result = await runNmr(args, extraEnv);

    expect(result.stdout).toMatch(/^PASS repo: test: passed on box in /m);
    expect(countRemoteRuns()).toBe(1);
  });

  it('keeps a pass earned here when the host passes the same tree', async () => {
    await runNmr(['--no-delegate', 'test']);
    await runNmr(['--delegate-to', 'box', '--no-cache', 'test']);

    const result = await runNmr(['--no-delegate', 'test']);

    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on this tree/m);
  });

  it('replaces a pass earned here that its build output no longer supports', async () => {
    // Build output is ignored, as in a real repository, so that removing it leaves the tree and the key alone.
    workspace.writeAll({
      'repo/.gitignore': 'node_modules/\ndist/\n',
      'repo/packages/a/dist/esm/index.js': 'export const value = 1;\n',
      'repo/packages/a/package.json': JSON.stringify({ name: 'a', type: 'module' }),
      'repo/packages/a/src/index.ts': 'export const value = 1;\n',
    });
    writeBuildDigest(workspace, 'repo/packages/a', 'digest-from-this-tree');
    await runNmr(['--no-delegate', 'test']);
    workspace.rm('repo/packages/a/dist');

    await runNmr(['--delegate-to', 'box', 'test']);
    const result = await runNmr(['--delegate-to', 'box', 'test']);

    expect(result.stdout).toMatch(/^SKIP repo: test: passed .* ago on box/m);
    expect(countRemoteRuns()).toBe(1);
  });

  it('reports an unknown command here without contacting the host', async () => {
    const result = await runNmr(['--delegate-to', 'box', 'ghost']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command: ghost');
    expect(remote.readPnpmLog()).toStrictEqual([]);
  });

  describe('the constituents that the host reports', () => {
    let packageDir: string;

    beforeEach(() => {
      workspace.writeAll({
        'repo/.config/nmr.config.ts': `export default ${JSON.stringify({
          rootScripts: { check: 'echo check-here', ci: 'echo ci-here', test: 'echo ran-here' },
          workspaceScripts: { test: 'echo package-test-here' },
        })};\n`,
        'repo/packages/a/package.json': '{ "name": "a" }\n',
      });
      packageDir = path.join(repo, 'packages', 'a');
    });

    it('recalls a constituent without contacting the host, and replays them when the composite is recalled', async () => {
      const [check] = await captureEntries(['--no-delegate', 'check']);
      const [packageTest] = await captureEntries(['--no-delegate', 'test'], packageDir);
      const [ci] = await captureEntries(['--no-delegate', 'ci']);
      const manifest = [
        { ...check, replay: [{ command: 'check', excerpt: 'check summary', scope: 'repo' }] },
        { ...packageTest, replay: [{ command: 'test', excerpt: '3 passed', scope: 'a' }] },
        {
          ...ci,
          replay: [
            { command: 'check', excerpt: 'check summary', scope: 'repo' },
            { command: 'test', excerpt: '3 passed', scope: 'a' },
          ],
        },
      ];
      await runNmr(['--delegate-to', 'box', 'ci'], { FAKE_RUN_MANIFEST: JSON.stringify(manifest) });

      const checkResult = await runNmr(['--delegate-to', 'box', 'check']);
      const testResult = await runNmr(['--delegate-to', 'box', 'test'], {}, packageDir);
      const ciResult = await runNmr(['--delegate-to', 'box', 'ci']);

      expect(checkResult.stdout).toMatch(/^SKIP repo: check: passed .* ago on box — replayed: check summary$/m);
      expect(testResult.stdout).toMatch(/^SKIP a: test: passed .* ago on box — replayed: 3 passed$/m);
      expect(ciResult.stdout).toMatch(/^SKIP repo: ci: passed .* ago on box/m);
      expect(ciResult.stdout).toContain('check summary');
      expect(ciResult.stdout).toContain('3 passed');
      expect(countRemoteRuns()).toBe(1);
    });

    it("prints a learned constituent's excerpt under --log, naming the host", async () => {
      const [check] = await captureEntries(['--no-delegate', 'check']);
      const manifest = [{ ...check, replay: [{ command: 'check', excerpt: 'check summary', scope: 'repo' }] }];
      await runNmr(['--delegate-to', 'box', 'ci'], { FAKE_RUN_MANIFEST: JSON.stringify(manifest) });

      const result = await runNmr(['--log', 'check']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^repo: check — recorded .* on box$/m);
      expect(result.stdout).toContain('check summary');
      expect(result.stdout).not.toContain('remote stdout');
    });

    it('does not recall a learned constituent for a run here', async () => {
      const [check] = await captureEntries(['--no-delegate', 'check']);
      await runNmr(['--delegate-to', 'box', 'ci'], { FAKE_RUN_MANIFEST: JSON.stringify([check]) });

      const result = await runNmr(['--no-delegate', 'check']);

      expect(result.stdout).toContain('check-here');
    });

    it('records the valid entries beside a malformed one and one outside the root', async () => {
      const [check] = await captureEntries(['--no-delegate', 'check']);
      const [packageTest] = await captureEntries(['--no-delegate', 'test'], packageDir);
      const manifest = [check, { command: 'test', scope: 'packages/a' }, { ...packageTest, scope: '../x' }];
      await runNmr(['--delegate-to', 'box', 'ci'], { FAKE_RUN_MANIFEST: JSON.stringify(manifest) });

      const checkResult = await runNmr(['--delegate-to', 'box', 'check']);
      const testResult = await runNmr(['--delegate-to', 'box', 'test'], {}, packageDir);

      expect(checkResult.stdout).toMatch(/^SKIP repo: check: passed .* ago on box/m);
      expect(testResult.stdout).toMatch(/^PASS a: test: passed on box in /m);
      await expect(
        readCheckCacheEntry({ anchorDir: path.resolve(repo, '../x'), command: 'test', monorepoRoot: repo }),
      ).resolves.toBeUndefined();
      expect(countRemoteRuns()).toBe(2);
    });

    it('records the composite alone, without retention, when the host returns no manifest', async () => {
      await runNmr(['--delegate-to', 'box', 'ci']);

      const entry = await readCheckCacheEntry({ anchorDir: repo, command: 'ci', monorepoRoot: repo });
      const checkResult = await runNmr(['--delegate-to', 'box', 'check']);

      expect(entry).toMatchObject({ host: 'box' });
      expect(entry?.retention).toBeUndefined();
      expect(checkResult.stdout).toMatch(/^PASS repo: check: passed on box in /m);
    });

    /**
     * Runs a command here with the pass manifest enabled and returns the entries that it reported, which a fake host
     * then reports as its own. The cache is cleared afterward, so that the passes earned here do not answer later runs.
     */
    async function captureEntries(args: string[], cwd = repo): Promise<Array<Record<string, unknown>>> {
      const manifestDir = fs.mkdtempSync(path.join(workspace.dir, 'manifest-'));
      await runNmr(args, { [PASS_MANIFEST_DIR_ENV_VAR]: manifestDir }, cwd);
      await removeCheckCache(repo);

      return fs
        .readdirSync(manifestDir)
        .map((name): unknown => JSON.parse(fs.readFileSync(path.join(manifestDir, name), 'utf8')))
        .filter((entry) => isObject(entry));
    }
  });

  /** Counts the commands that the fake host ran, as distinct from its installs. */
  function countRemoteRuns(): number {
    return remote.readPnpmLog().filter((line) => line.startsWith('args=')).length;
  }

  /** Runs the CLI in-process in the repo, with `ssh` and `pnpm` resolving to the fakes and plain output. */
  async function runNmr(args: string[], extraEnv: Record<string, string> = {}, cwd = repo) {
    const stdout = captureStream();
    const stderr = captureStream();

    const { exitCode } = await runCli({
      args,
      cwd,
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
