/* eslint-disable no-restricted-syntax -- this suite does not use a tree, managing its temporary directories by hand until #622 converts it. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CLI_PATH,
  makeLogHelpers,
  MONOREPO_ROOT,
  NMR_PACKAGE_DIR,
  runNmr,
  warmBin,
} from '../test-utils/nmr-bin-harness.ts';
import { readAmbientEnv } from '../test-utils/readAmbientEnv.ts';

describe('nmr CLI', () => {
  // Warm the bin once per file, so that the hook subprocesses (`nmr X:pre`, `nmr X:post`) start cold once per file
  // rather than once per `it`.
  beforeAll(() => {
    warmBin();
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

  it('shows help when run without a command', async () => {
    const { stdout, exitCode } = await runNmr('');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
  });

  it('exits with error for unknown command', async () => {
    const { exitCode } = await runNmr('nonexistent-command');
    expect(exitCode).toBe(1);
  });

  it('exits 1 with a canonical Error line when -F is missing its argument', async () => {
    const { stderr, exitCode } = await runNmr('-F');
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Error: -F/--filter requires a pattern argument');
  });

  // The bin (`cli.ts`) sets `process.exitCode` and returns rather than calling `process.exit()`, so that output
  // drains before the process exits. These spawn the real built bin to observe the kernel exit code and prompt
  // termination; the in-process `runNmr` tests bypass the bin wrapper and cannot exercise that behavior.
  //
  // Each spawn runs on the ambient environment: A subprocess inherits `process.env` whole, and this suite running
  // under `nmr test` would otherwise pass the bin an `NMR_RUN_IF_PRESENT` that turns the unknown command below
  // into the silent success that the assertion is written to catch.
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
    it('reports an invalid config as a message alone, without a stack trace', () => {
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

  describe('override script messages', () => {
    let tempRoot: string;
    let overridePackageDir: string;
    let noopPackageDir: string;
    let prototypeNamePackageDir: string;

    beforeAll(() => {
      tempRoot = mkdtempSync(path.join(tmpdir(), 'nmr-test-'));
      writeFileSync(path.join(tempRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");

      overridePackageDir = path.join(tempRoot, 'packages', 'test-override');
      mkdirSync(overridePackageDir, { recursive: true });
      writeFileSync(
        path.join(overridePackageDir, 'package.json'),
        JSON.stringify({ name: 'test-override', scripts: { build: 'echo ok' } }),
      );

      noopPackageDir = path.join(tempRoot, 'packages', 'test-noop');
      mkdirSync(noopPackageDir, { recursive: true });
      writeFileSync(
        path.join(noopPackageDir, 'package.json'),
        JSON.stringify({ name: 'test-noop', scripts: { build: ':' } }),
      );

      prototypeNamePackageDir = path.join(tempRoot, 'packages', 'test-prototype-name');
      mkdirSync(prototypeNamePackageDir, { recursive: true });
      writeFileSync(
        path.join(prototypeNamePackageDir, 'package.json'),
        JSON.stringify({ name: 'test-prototype-name', scripts: { toString: 'echo ok' } }),
      );
    });

    afterAll(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('includes package name in override-script message', async () => {
      const { stdout } = await runNmr('build', { cwd: overridePackageDir });
      expect(stdout).toContain('test-override: Using override script: echo ok');
    });

    it('distinguishes a colon override from a command that passed', async () => {
      const { stdout, exitCode } = await runNmr('build', { cwd: noopPackageDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('NOOP test-noop: build: skipped, the override is a no-op');
    });

    it('suppresses override-script message in quiet mode', async () => {
      const { stdout } = await runNmr('--quiet build', { cwd: overridePackageDir });
      expect(stdout).not.toContain('Using override script');
    });

    // The registry is a plain object, so an unguarded lookup of `toString` finds the inherited function rather
    // than the `undefined` that suppresses the notice. Exit 0 is the indirect assertion that the script ran.
    it('does not announce an override for a script named for an `Object.prototype` member', async () => {
      const { stdout, exitCode } = await runNmr('toString', { cwd: prototypeNamePackageDir });

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
    let quietPackageDir: string;

    beforeAll(() => {
      quietRoot = mkdtempSync(path.join(tmpdir(), 'nmr-quiet-'));
      writeFileSync(path.join(quietRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      quietPackageDir = path.join(quietRoot, 'packages', 'quiet-pkg');
      mkdirSync(quietPackageDir, { recursive: true });
      writeFileSync(
        path.join(quietPackageDir, 'package.json'),
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
      const { stdout, stderr, exitCode } = await runNmr('-q typecheck', { cwd: quietPackageDir });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^PASS [\w-]+: typecheck: passed in [\d.]+s\n$/);
      expect(stderr).toBe('');
    });

    it('still exits with error for unknown command when quiet', async () => {
      const { stderr, exitCode } = await runNmr('--quiet nonexistent-command');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Error: Unknown command');
    });
  });

  describe('script working directory', () => {
    let anchorRoot: string;
    let anchorPackageDir: string;
    let anchorLogFile: string;

    beforeAll(() => {
      anchorRoot = mkdtempSync(path.join(tmpdir(), 'nmr-anchor-'));
      writeFileSync(path.join(anchorRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
      anchorLogFile = path.join(anchorRoot, 'log.txt');
      writeFileSync(anchorLogFile, '');

      // Each candidate directory contains a `where.txt` naming itself; the scripts `cat where.txt`. The
      // logged word is the directory in which the script ran. `pwd` would compare a physical path against the
      // symlinked one that mkdtempSync returns on macOS.
      writeFileSync(path.join(anchorRoot, 'where.txt'), 'root\n');

      // Root context without a workspace package.
      mkdirSync(path.join(anchorRoot, 'tools'), { recursive: true });
      writeFileSync(path.join(anchorRoot, 'tools', 'where.txt'), 'sub\n');

      anchorPackageDir = path.join(anchorRoot, 'packages', 'anchor-pkg');
      mkdirSync(path.join(anchorPackageDir, 'src'), { recursive: true });
      writeFileSync(path.join(anchorPackageDir, 'package.json'), JSON.stringify({ name: 'anchor-pkg' }));
      writeFileSync(path.join(anchorPackageDir, 'where.txt'), 'pkg\n');
      writeFileSync(path.join(anchorPackageDir, 'src', 'where.txt'), 'src\n');

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
      const { exitCode } = await runNmr('-w anchor-where', { cwd: anchorPackageDir });
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
      const { exitCode } = await runNmr('anchor-where', { cwd: path.join(anchorPackageDir, 'src') });
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
      const { exitCode } = await runNmr('-w anchor-chain', { cwd: anchorPackageDir });
      expect(exitCode).toBe(0);
      expect(readAnchorLog()).toStrictEqual(['inner']);
    });
  });
});
