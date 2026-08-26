/* eslint-disable no-restricted-syntax -- this suite holds no tree, managing its temporary directories by hand until #622 converts it. */
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli } from '../runCli.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

function makeLogHelpers(getPath: () => string): { read: () => string[]; clear: () => void } {
  return {
    read: () => {
      try {
        return readFileSync(getPath(), 'utf8')
          .split('\n')
          .filter((line) => line.length > 0);
      } catch {
        return [];
      }
    },
    clear: () => writeFileSync(getPath(), ''),
  };
}

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');
const CLI_PATH = path.join(NMR_PACKAGE_DIR, 'dist', 'esm', 'cli.js');

// Default pattern for nmr CLI tests: call `runCli` in-process with PassThrough streams rather than spawning a
// `node` subprocess. This avoids the cold-start variance that made early subprocess-based tests timeout-prone.
// Reach for a subprocess test only when verifying real-process behavior the in-process path cannot exercise
// (signals, env-var inheritance through the bin shim, kernel exit codes).
//
// The bin subprocess that hook-wrap spawns for `nmr X:pre` / `nmr X:post` is production behavior and is not touched
// here — it gets warmed by the file-level `beforeAll`. To debug a failing test, temporarily swap
// `stdoutStream`/`stderrStream` for `process.stdout`/`process.stderr` to see inner subprocess output live.
//
// Arguments are split on whitespace; no shell-style quoting.
// If a test needs quoted arguments, call `runCli` directly with a pre-built `args` array.
async function runNmr(
  argString: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args = argString.length === 0 ? [] : argString.split(/\s+/).filter((s) => s.length > 0);
  const ambient = readAmbientEnv();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  stdoutStream.on('data', (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  stderrStream.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  const { exitCode } = await runCli({
    args,
    cwd: options.cwd ?? MONOREPO_ROOT,
    env: { ...ambient, ...options.env },
    stdout: stdoutStream,
    stderr: stderrStream,
  });

  return {
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    exitCode,
  };
}

describe('nmr CLI', () => {
  // Warm the OS page cache for `node` + the nmr dist so the inner hook subprocesses (`nmr X:pre`, `nmr X:post`) that
  // production hook-wrap continues to spawn pay cold-start cost once per file rather than once per `it`. Failure here
  // is non-fatal: tests still pass against a cold cache, just more slowly.
  beforeAll(() => {
    try {
      execSync(`node ${CLI_PATH} --help`, { env: readAmbientEnv(), stdio: 'ignore', timeout: 10_000 });
    } catch {
      // Swallow warmup failure — tests will surface real issues themselves.
    }
  });

  // The bin (`cli.ts`) sets `process.exitCode` and returns rather than calling `process.exit()`, so output drains
  // before the process exits. These spawn the real built bin to observe the kernel exit code and prompt termination;
  // the in-process `runNmr` tests bypass the bin wrapper and cannot exercise that behavior.
  //
  // Each spawn runs on the ambient environment: a subprocess inherits `process.env` whole, and this suite running
  // under `nmr test` would otherwise hand the bin an `NMR_RUN_IF_PRESENT` that turns the unknown command below
  // into the silent success the assertion is written to catch.
  describe('process exit behavior via the real bin (subprocess)', () => {
    it('exits 0 for --help', () => {
      const result = spawnSync('node', [CLI_PATH, '--help'], {
        cwd: MONOREPO_ROOT,
        encoding: 'utf8',
        env: readAmbientEnv(),
        timeout: 15_000,
      });
      // A lingering-handle hang would hit the timeout and leave status null, failing this assertion.
      expect(result.status).toBe(0);
    });

    // A config mistake names a file to edit; a stack trace names where nmr noticed it, which is nmr's business.
    it('reports an invalid config as a message alone, with no stack trace', () => {
      const repo = mkdtempSync(path.join(tmpdir(), 'nmr-config-error-'));
      writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
      mkdirSync(path.join(repo, '.config'), { recursive: true });
      writeFileSync(path.join(repo, '.config', 'nmr.config.ts'), 'export default { notAKey: 1 };\n');

      try {
        const result = spawnSync('node', [CLI_PATH, 'fmt'], {
          cwd: repo,
          encoding: 'utf8',
          env: readAmbientEnv(),
          timeout: 15_000,
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Error: Invalid nmr config at');
        expect(result.stderr).not.toContain('    at ');
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    });

    it('exits 1 for an unknown command', () => {
      const result = spawnSync('node', [CLI_PATH, 'definitely-not-a-real-command'], {
        cwd: MONOREPO_ROOT,
        encoding: 'utf8',
        env: readAmbientEnv(),
        timeout: 15_000,
      });
      expect(result.status).toBe(1);
    });
  });

  it('shows help with --help flag', async () => {
    const { stdout, exitCode } = await runNmr('--help');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
    expect(stdout).toContain('Workspace commands:');
    expect(stdout).toContain('Root commands:');
  });

  it('shows help with -? flag', async () => {
    const { stdout, exitCode } = await runNmr('-?');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
  });

  it('shows help when no command is given', async () => {
    const { stdout, exitCode } = await runNmr('');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
  });

  it('exits with error for unknown command', async () => {
    const { exitCode } = await runNmr('nonexistent-command');
    expect(exitCode).toBe(1);
  });

  it('exits 1 with a canonical Error line when -F has no argument', async () => {
    const { stderr, exitCode } = await runNmr('-F');
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Error: -F/--filter requires a pattern argument');
  });

  describe('override script messages', () => {
    let tempRoot: string;
    let overridePkgDir: string;
    let noopPkgDir: string;
    let prototypeNamePkgDir: string;

    beforeAll(() => {
      tempRoot = mkdtempSync(path.join(tmpdir(), 'nmr-test-'));
      writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");

      overridePkgDir = path.join(tempRoot, 'packages', 'test-override');
      mkdirSync(overridePkgDir, { recursive: true });
      writeFileSync(
        path.join(overridePkgDir, 'package.json'),
        JSON.stringify({ name: 'test-override', scripts: { build: 'echo ok' } }),
      );

      noopPkgDir = path.join(tempRoot, 'packages', 'test-noop');
      mkdirSync(noopPkgDir, { recursive: true });
      writeFileSync(
        path.join(noopPkgDir, 'package.json'),
        JSON.stringify({ name: 'test-noop', scripts: { build: ':' } }),
      );

      prototypeNamePkgDir = path.join(tempRoot, 'packages', 'test-prototype-name');
      mkdirSync(prototypeNamePkgDir, { recursive: true });
      writeFileSync(
        path.join(prototypeNamePkgDir, 'package.json'),
        JSON.stringify({ name: 'test-prototype-name', scripts: { toString: 'echo ok' } }),
      );
    });

    afterAll(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('includes package name in override-script message', async () => {
      const { stdout } = await runNmr('build', { cwd: overridePkgDir });
      expect(stdout).toContain('📦 test-override: Using override script: echo ok');
    });

    it('distinguishes a colon override from a command that passed', async () => {
      const { stdout, exitCode } = await runNmr('build', { cwd: noopPkgDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('⛔ test-noop: build: skipped, the override is a no-op');
    });

    it('suppresses override-script message in quiet mode', async () => {
      const { stdout } = await runNmr('--quiet build', { cwd: overridePkgDir });
      expect(stdout).not.toContain('Using override script');
    });

    // The registry is a plain object, so an unguarded lookup of `toString` finds the inherited function rather
    // than the `undefined` that suppresses the notice. Exit 0 is the indirect assertion that the script ran.
    it('announces no override for a script named for an `Object.prototype` member', async () => {
      const { stdout, exitCode } = await runNmr('toString', { cwd: prototypeNamePkgDir });

      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('Using override script');
    });
  });

  describe('NMR_RUN_IF_PRESENT', () => {
    it('exits 0 for unknown command when set', async () => {
      const { exitCode, stderr } = await runNmr('nonexistent-command', {
        env: { NMR_RUN_IF_PRESENT: '1' },
      });
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
    });

    it('still exits 1 for unknown command when not set', async () => {
      const { exitCode } = await runNmr('nonexistent-command');
      expect(exitCode).toBe(1);
    });
  });

  describe('--quiet flag', () => {
    // A fixture rather than this repo's own package: `typecheck` is cacheable, so running it here would record
    // a pass into the developer's own check-result cache as a side effect of running the suite.
    let quietRoot: string;
    let quietPkgDir: string;

    beforeAll(() => {
      quietRoot = mkdtempSync(path.join(tmpdir(), 'nmr-quiet-'));
      writeFileSync(path.join(quietRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      quietPkgDir = path.join(quietRoot, 'packages', 'quiet-pkg');
      mkdirSync(quietPkgDir, { recursive: true });
      writeFileSync(
        path.join(quietPkgDir, 'package.json'),
        JSON.stringify({ name: 'quiet-pkg', scripts: { typecheck: 'echo noise && echo trouble >&2' } }),
      );
    });

    afterAll(() => {
      rmSync(quietRoot, { recursive: true, force: true });
    });

    it('accepts -q flag without parse errors', async () => {
      const { stdout, exitCode } = await runNmr('-q --help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: nmr');
    });

    it('accepts --quiet flag without parse errors', async () => {
      const { stdout, exitCode } = await runNmr('--quiet --help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: nmr');
    });

    it('shows -q, --quiet in help output', async () => {
      const { stdout } = await runNmr('--help');
      expect(stdout).toContain('-q, --quiet');
    });

    it('suppresses the command output on a successful quiet run, leaving the verdict', async () => {
      const { stdout, stderr, exitCode } = await runNmr('-q typecheck', { cwd: quietPkgDir });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^✅ [\w-]+: typecheck: passed in [\d.]+s\n$/);
      expect(stderr).toBe('');
    });

    it('still exits with error for unknown command when quiet', async () => {
      const { stderr, exitCode } = await runNmr('--quiet nonexistent-command');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Error: Unknown command');
    });
  });

  describe('pre/post hooks', () => {
    let tempRoot: string;
    let logFile: string;

    /**
     * Writes a workspace package whose scripts append a marker line to a log file when invoked.
     * The `clean` script is overridden because clean is in the default registry (so resolving it triggers the
     * override path), and we layer hook scripts on top in tier-3 (package.json) where appropriate.
     */
    function writePackage(packageDir: string, scripts: Record<string, string>, packageName = 'hook-pkg'): void {
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName, scripts }));
    }

    const { read: readLog, clear: clearLog } = makeLogHelpers(() => logFile);

    beforeAll(() => {
      tempRoot = mkdtempSync(path.join(tmpdir(), 'nmr-hooks-test-'));
      writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'temp-root', private: true }));
      mkdirSync(path.join(tempRoot, 'packages'), { recursive: true });
      logFile = path.join(tempRoot, 'log.txt');
      writeFileSync(logFile, '');
    });

    afterAll(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('runs pre and post hooks around the main command', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'both-hooks');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'both-hooks',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
    });

    it('runs pre-only hook when post is undefined', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'pre-only');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
        },
        'pre-only',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'main']);
    });

    it('runs post-only hook when pre is undefined', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'post-only');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'post-only',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
    });

    it('is a silent no-op when no hooks are defined', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'no-hooks');
      writePackage(pkgDir, { clean: `echo main >> ${logFile}` }, 'no-hooks');
      clearLog();

      const { exitCode, stderr } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main']);
      expect(stderr).toBe('');
    });

    it('short-circuits when pre-hook fails — main and post do not run', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'pre-fails');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile} && exit 7`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'pre-fails',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(7);
      expect(readLog()).toStrictEqual(['pre']);
    });

    it('short-circuits when main fails — post does not run', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'main-fails');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile} && exit 5`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'main-fails',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(5);
      expect(readLog()).toStrictEqual(['pre', 'main']);
    });

    it('propagates the exit code when post-hook fails', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'post-fails');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile} && exit 9`,
        },
        'post-fails',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(9);
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
    });

    it('runs hooks when the main command is overridden in package.json', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'override-main');
      writePackage(
        pkgDir,
        {
          clean: `echo override-main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'override-main',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'override-main', 'post']);
    });

    it('directly invokes the pre hook without cascading', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'direct-pre');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'direct-pre',
      );
      clearLog();

      const { exitCode, stderr } = await runNmr('clean:pre', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      // Only the pre hook itself should run — no cascading attempt to find pre:pre/pre:post
      expect(readLog()).toStrictEqual(['pre']);
      expect(stderr).not.toContain('Unknown command');
    });

    it('directly invokes the post hook without cascading', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'direct-post');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'direct-post',
      );
      clearLog();

      const { exitCode, stderr } = await runNmr('clean:post', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['post']);
      expect(stderr).not.toContain('Unknown command');
    });

    it('attaches passthrough args to the main command only', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'passthrough');
      // Use a wrapper script so we can capture argv without shell-redirection
      // ambiguities (where `>> file --flag` would parse as redirect + extra args).
      const captureScript = path.join(pkgDir, 'capture.sh');
      writePackage(
        pkgDir,
        {
          clean: `bash ${captureScript} main`,
          'clean:pre': `bash ${captureScript} pre`,
          'clean:post': `bash ${captureScript} post`,
        },
        'passthrough',
      );
      writeFileSync(captureScript, `#!/bin/bash\nlabel="$1"\nshift\necho "$label args=$*" >> ${logFile}\n`);
      clearLog();

      const { exitCode } = await runNmr('clean --flag value', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre args=', 'main args=--flag value', 'post args=']);
    });

    it('skips hooks when main command is overridden to empty string', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'main-skip-empty');
      writePackage(
        pkgDir,
        {
          clean: '',
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'main-skip-empty',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual([]);
    });

    it('skips hooks when main command is overridden to colon', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'main-skip-colon');
      writePackage(
        pkgDir,
        {
          clean: ':',
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'main-skip-colon',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual([]);
    });

    it('treats empty-string hook as silent no-op', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'hook-skip-empty');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': '',
          'clean:post': `echo post >> ${logFile}`,
        },
        'hook-skip-empty',
      );
      clearLog();

      const { stdout, exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
      // No "Skipping" message should appear for the hook
      expect(stdout).not.toContain('Skipping');
    });

    it('treats colon-valued hook as silent no-op', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'hook-skip-colon');
      writePackage(
        pkgDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': ':',
          'clean:post': `echo post >> ${logFile}`,
        },
        'hook-skip-colon',
      );
      clearLog();

      const { stdout, exitCode } = await runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
      expect(stdout).not.toContain('no-op');
    });

    it('suppresses hook chain output under --quiet', async () => {
      const pkgDir = path.join(tempRoot, 'packages', 'quiet-hooks');
      writePackage(
        pkgDir,
        {
          clean: `echo main-noise && echo main >> ${logFile}`,
          'clean:pre': `echo pre-noise && echo pre >> ${logFile}`,
          'clean:post': `echo post-noise && echo post >> ${logFile}`,
        },
        'quiet-hooks',
      );
      clearLog();

      const { stdout, exitCode } = await runNmr('-q clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      // Log proves the full chain ran
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
      expect(stdout).not.toContain('noise');
      // Each hook is a leaf of the chain `clean` reports on, so one verdict covers all three.
      expect(stdout.split('\n').filter((line) => line.length > 0)).toHaveLength(1);
    });

    describe('config-defined hooks', () => {
      let configRoot: string;
      let configPkgDir: string;
      let configLogFile: string;

      beforeAll(() => {
        configRoot = mkdtempSync(path.join(tmpdir(), 'nmr-hooks-cfg-'));
        writeFileSync(path.join(configRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
        mkdirSync(path.join(configRoot, '.config'), { recursive: true });
        configLogFile = path.join(configRoot, 'log.txt');
        writeFileSync(configLogFile, '');

        // Root package.json scripts are tier 3 from root cwd; under -w from a subpackage they should resolve via
        // root's package.json, not the subpackage's. Defining wpkg-cmd here exercises that path.
        writeFileSync(
          path.join(configRoot, 'package.json'),
          JSON.stringify({
            name: 'cfg-root',
            private: true,
            scripts: {
              'wpkg-cmd': `echo wpkg-main >> ${configLogFile}`,
              'wpkg-cmd:pre': `echo wpkg-pre >> ${configLogFile}`,
              'wpkg-cmd:post': `echo wpkg-post >> ${configLogFile}`,
            },
          }),
        );

        // Composite hook (array) — only allowed in tier 1+2, so requires .config/nmr.config.ts
        // rootScripts entries also live here; they are reachable only via -w from a package cwd.
        const configContent = `import { defineConfig } from '${NMR_PACKAGE_DIR}/dist/esm/defineConfig.js';
export default defineConfig({
  workspaceScripts: {
    'clean:pre': ['cfg-pre-step1', 'cfg-pre-step2'],
    'cfg-pre-step1': 'echo step1 >> ${configLogFile}',
    'cfg-pre-step2': 'echo step2 >> ${configLogFile}',
    'clean:post': 'echo cfg-post >> ${configLogFile}',
  },
  rootScripts: {
    'wroot-cmd': 'echo wroot-main >> ${configLogFile}',
    'wroot-cmd:pre': 'echo wroot-pre >> ${configLogFile}',
    'wroot-cmd:post': 'echo wroot-post >> ${configLogFile}',
    'wroot-composite': ['wroot-step1', 'wroot-step2'],
    'wroot-step1': 'echo wroot-step1 >> ${configLogFile}',
    'wroot-step2': 'echo wroot-step2 >> ${configLogFile}',
  },
});
`;
        writeFileSync(path.join(configRoot, '.config', 'nmr.config.ts'), configContent);

        configPkgDir = path.join(configRoot, 'packages', 'cfg-pkg');
        mkdirSync(configPkgDir, { recursive: true });
        writeFileSync(
          path.join(configPkgDir, 'package.json'),
          JSON.stringify({
            name: 'cfg-pkg',
            scripts: { clean: `echo main >> ${configLogFile}` },
          }),
        );
      });

      afterAll(() => {
        rmSync(configRoot, { recursive: true, force: true });
      });

      const { read: readConfigLog, clear: clearConfigLog } = makeLogHelpers(() => configLogFile);

      it('runs hooks when main command is overridden in package.json (composite pre)', async () => {
        clearConfigLog();
        const { exitCode } = await runNmr('clean', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        // composite pre-hook expands to nmr cfg-pre-step1 && nmr cfg-pre-step2
        expect(readConfigLog()).toStrictEqual(['step1', 'step2', 'main', 'cfg-post']);
      });

      it('propagates -w to hook subprocesses so they resolve via root registry', async () => {
        clearConfigLog();
        // wroot-cmd and its hooks live only in rootScripts. Without -w propagation,
        // the parent's `useRoot=true` decision is lost in the subprocess `nmr X:pre` call,
        // and the child re-derives a workspace registry from the package cwd, failing to resolve the hook.
        const { exitCode } = await runNmr('-w wroot-cmd', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wroot-pre', 'wroot-main', 'wroot-post']);
      });

      it('propagates -w through composite-script step subprocesses', async () => {
        clearConfigLog();
        // wroot-composite and its steps live only in rootScripts. The composite expands to `nmr -w wroot-step1 && nmr
        // -w wroot-step2` so each child resolves via the root registry. Without -w propagation in expandScript, the
        // children re-derive a workspace registry from the package cwd and fail with "Unknown command".
        const { exitCode } = await runNmr('-w wroot-composite', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wroot-step1', 'wroot-step2']);
      });

      // Reaches `useRoot` through `context.isRoot` rather than through the `-w` flag (the two disjuncts at runCli.ts).
      // This is the path an ordinary root `package.json` script takes.
      it('resolves tier-3 (root package.json) scripts at the monorepo root', async () => {
        clearConfigLog();
        const { exitCode } = await runNmr('wpkg-cmd', { cwd: configRoot });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wpkg-pre', 'wpkg-main', 'wpkg-post']);
      });

      it('resolves tier-3 (root package.json) scripts under -w from a subpackage', async () => {
        clearConfigLog();
        // wpkg-cmd and its hooks live only in the root package.json scripts (tier 3 from root cwd).
        // Under -w from a subpackage, packageDir must follow useRoot so the resolver consults root's package.json
        // instead of the subpackage's, otherwise the command and its hooks fail with "Unknown command".
        const { stdout, exitCode } = await runNmr('-w wpkg-cmd', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wpkg-pre', 'wpkg-main', 'wpkg-post']);
        // wpkg-cmd is in no registry, so the override-script message is suppressed: it announces a
        // package.json script that *replaces* a built-in, not every tier-3 entry that happens to resolve.
        expect(stdout).not.toContain('Using override script');
      });
    });
  });

  describe('script working directory', () => {
    let anchorRoot: string;
    let anchorPkgDir: string;
    let anchorLogFile: string;

    beforeAll(() => {
      anchorRoot = mkdtempSync(path.join(tmpdir(), 'nmr-anchor-'));
      writeFileSync(path.join(anchorRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      anchorLogFile = path.join(anchorRoot, 'log.txt');
      writeFileSync(anchorLogFile, '');

      // Each candidate directory holds a `where.txt` naming itself; the scripts `cat where.txt`, so the
      // logged word is the directory the script ran in. `pwd` would compare a physical path against the
      // symlinked one mkdtempSync returns on macOS.
      writeFileSync(path.join(anchorRoot, 'where.txt'), 'root\n');

      // Root context without a workspace package.
      mkdirSync(path.join(anchorRoot, 'tools'), { recursive: true });
      writeFileSync(path.join(anchorRoot, 'tools', 'where.txt'), 'sub\n');

      anchorPkgDir = path.join(anchorRoot, 'packages', 'anchor-pkg');
      mkdirSync(path.join(anchorPkgDir, 'src'), { recursive: true });
      writeFileSync(path.join(anchorPkgDir, 'package.json'), JSON.stringify({ name: 'anchor-pkg' }));
      writeFileSync(path.join(anchorPkgDir, 'where.txt'), 'pkg\n');
      writeFileSync(path.join(anchorPkgDir, 'src', 'where.txt'), 'src\n');

      // `anchor-inner` lives only in rootScripts; `anchor-where` in both.
      mkdirSync(path.join(anchorRoot, '.config'), { recursive: true });
      writeFileSync(
        path.join(anchorRoot, '.config', 'nmr.config.ts'),
        `import { defineConfig } from '${NMR_PACKAGE_DIR}/dist/esm/defineConfig.js';
export default defineConfig({
  rootScripts: {
    'anchor-where': 'cat where.txt >> ${anchorLogFile}',
    'anchor-chain': 'nmr anchor-inner',
    'anchor-inner': 'echo inner >> ${anchorLogFile}',
  },
  workspaceScripts: {
    'anchor-where': 'cat where.txt >> ${anchorLogFile}',
  },
});
`,
      );
    });

    afterAll(() => {
      rmSync(anchorRoot, { recursive: true, force: true });
    });

    const { read: readAnchorLog, clear: clearAnchorLog } = makeLogHelpers(() => anchorLogFile);

    it('runs a root script at the monorepo root under -w from a package dir', async () => {
      clearAnchorLog();
      const { exitCode } = await runNmr('-w anchor-where', { cwd: anchorPkgDir });
      expect(exitCode).toBe(0);
      expect(readAnchorLog()).toStrictEqual(['root']);
    });

    it('runs a root script at the monorepo root from a non-package root subdirectory', async () => {
      clearAnchorLog();
      const { exitCode } = await runNmr('anchor-where', { cwd: path.join(anchorRoot, 'tools') });
      expect(exitCode).toBe(0);
      expect(readAnchorLog()).toStrictEqual(['root']);
    });

    it('runs a workspace script at the package root from a subdirectory of the package', async () => {
      clearAnchorLog();
      const { exitCode } = await runNmr('anchor-where', { cwd: path.join(anchorPkgDir, 'src') });
      expect(exitCode).toBe(0);
      expect(readAnchorLog()).toStrictEqual(['pkg']);
    });

    it('leaves root-cwd invocation unchanged', async () => {
      clearAnchorLog();
      const { exitCode } = await runNmr('anchor-where', { cwd: anchorRoot });
      expect(exitCode).toBe(0);
      expect(readAnchorLog()).toStrictEqual(['root']);
    });

    it('resolves a root-only command chained inside a root script string', async () => {
      clearAnchorLog();
      const { exitCode } = await runNmr('-w anchor-chain', { cwd: anchorPkgDir });
      expect(exitCode).toBe(0);
      expect(readAnchorLog()).toStrictEqual(['inner']);
    });
  });
});
