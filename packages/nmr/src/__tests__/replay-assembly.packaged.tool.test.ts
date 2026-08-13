import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCheckCacheEntry } from '../check-cache.ts';
import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

// A composite admits only what its own run certified, so an assembly here is also the proof that the witness
// reached a real child through the environment of a real spawn. Those children run the built `nmr` on `PATH`
// rather than this source, which is what the `packaged` segment of the filename records: a stale `dist` fails
// this file and nothing else.
describe('a composite’s assembled replay', () => {
  let repo: string;
  let scope: string;

  // A fixture per test, so each one decides for itself which of the fixture's commands are already warm.
  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-assembly-e2e-')));
    scope = path.basename(repo);
    scaffoldRepo(repo);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('records what its constituents wrote, in the order its steps name them', async () => {
    const { exitCode } = await runNmr(['-q', 'check']);

    expect(exitCode).toBe(0);
    await expect(readEntry('check')).resolves.toMatchObject({
      retention: {
        replay: [
          { command: 'typecheck', excerpt: 'typecheck summary', scope },
          { command: 'lint:check', excerpt: 'lint summary', scope },
        ],
      },
    });
  });

  it('replays them on the skip line, each attributed to the command that produced it', async () => {
    await runNmr(['-q', 'check']);

    const { exitCode, stdout } = await runNmr(['-q', 'check']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('on this tree');
    expect(stdout).toContain(`replayed: ${scope}: typecheck: typecheck summary; ${scope}: lint:check: lint summary`);
  });

  it('keeps a constituent that was already warm when the composite ran', async () => {
    await runNmr(['-q', 'typecheck']);

    const { stdout } = await runNmr(['-q', 'check']);

    // The warm constituent skipped and was certified by this run; the other ran in it.
    expect(stdout).toContain(`⏭️ ${scope}: typecheck:`);
    expect(stdout).toContain(`✅ ${scope}: lint:check:`);
    await expect(readEntry('check')).resolves.toMatchObject({
      retention: {
        replay: [
          { command: 'typecheck', excerpt: 'typecheck summary', scope },
          { command: 'lint:check', excerpt: 'lint summary', scope },
        ],
      },
    });
  });

  // A composite retains nothing of its own, so the assembly is the whole of what it has to show a reader.
  it('is what --log prints for the composite, one attributed line per constituent', async () => {
    await runNmr(['-q', 'check']);

    const { exitCode, stdout } = await runNmr(['--log', 'check']);

    expect(exitCode).toBe(0);
    expect(stdout).toContain(`${scope}: typecheck: typecheck summary\n${scope}: lint:check: lint summary\n`);
  });

  it('leaves a constituent’s own transcript to that constituent’s --log', async () => {
    await runNmr(['-q', 'check']);

    const { stdout } = await runNmr(['--log', 'typecheck']);

    expect(stdout).toContain('typecheck summary');
    expect(stdout).not.toContain('lint summary');
  });

  it('carries one identity to every scope, so the constituents’ entries name the run above them', async () => {
    await runNmr(['-q', 'check']);

    const [composite, constituent] = await Promise.all([readEntry('check'), readEntry('typecheck')]);

    expect(composite?.retention?.runId).toBeDefined();
    expect(constituent?.retention?.runId).toBe(composite?.retention?.runId);
  });

  // region | Helpers

  /** Reads the entry the fixture's runs record for one command at the repository root. */
  async function readEntry(command: string) {
    return readCheckCacheEntry({ anchorDir: repo, command, monorepoRoot: repo });
  }

  /** Runs the CLI in-process against the fixture, its constituents spawning the built nmr off `PATH`. */
  async function runNmr(args: string[]): Promise<{ exitCode: number; stdout: string }> {
    const chunks: Buffer[] = [];
    const stdout = new PassThrough();
    stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const { exitCode } = await runCli({ args, cwd: repo, env: readAmbientEnv(), stderr: new PassThrough(), stdout });

    return { exitCode, stdout: Buffer.concat(chunks).toString('utf8') };
  }

  // endregion | Helpers
});

// region | Helpers

/** Runs git in `cwd`, discarding its output. */
function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/**
 * Writes a committed pnpm workspace inside a git repository: the pnpm files the install fingerprint reads, and
 * a cacheable composite whose two cacheable constituents each print one line.
 *
 * `node_modules` is ignored because the entries the run records land there: untracked, they would move the
 * very tree hash the run is being recorded against.
 */
function scaffoldRepo(repo: string): void {
  fs.mkdirSync(path.join(repo, 'node_modules', '.pnpm'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', '.modules.yaml'), 'hoistPattern:\n  - "types"\n');
  fs.writeFileSync(path.join(repo, 'node_modules', '.pnpm', 'lock.yaml'), 'lockfileVersion: "9.0"\n');

  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'assembly-root', private: true }));

  const config = {
    rootScripts: {
      check: ['typecheck', 'lint:check'],
      'lint:check': "echo 'lint summary'",
      typecheck: "echo 'typecheck summary'",
    },
  };
  fs.mkdirSync(path.join(repo, '.config'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.config', 'nmr.config.ts'), `export default ${JSON.stringify(config)};\n`);

  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'fixture@example.com']);
  git(repo, ['config', 'user.name', 'Fixture']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '--all']);
  git(repo, ['commit', '--message', 'initial']);
}

// endregion | Helpers
