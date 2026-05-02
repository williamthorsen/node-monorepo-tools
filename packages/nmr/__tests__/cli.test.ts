import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const MONOREPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const NMR_PACKAGE_DIR = path.resolve(MONOREPO_ROOT, 'packages', 'nmr');
const CLI_PATH = path.join(NMR_PACKAGE_DIR, 'dist', 'esm', 'cli.js');

function runNmr(
  args: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      cwd: options.cwd ?? MONOREPO_ROOT,
      env: { ...process.env, ...options.env },
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    const stdout =
      error !== null && typeof error === 'object' && 'stdout' in error && typeof error.stdout === 'string'
        ? error.stdout
        : '';
    const stderr =
      error !== null && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr
        : '';
    const exitCode =
      error !== null && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 1;
    return { stdout, stderr, exitCode };
  }
}

describe('nmr CLI', () => {
  it('shows help with --help flag', () => {
    const { stdout, exitCode } = runNmr('--help');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
    expect(stdout).toContain('Workspace commands:');
    expect(stdout).toContain('Root commands:');
  });

  it('shows help with -? flag', () => {
    const { stdout, exitCode } = runNmr('-?');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
  });

  it('shows help when no command is given', () => {
    const { stdout, exitCode } = runNmr('');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: nmr');
  });

  it('exits with error for unknown command', () => {
    const { exitCode } = runNmr('nonexistent-command');
    expect(exitCode).toBe(1);
  });

  it('resolves root package.json scripts at monorepo root', () => {
    const { exitCode } = runNmr('postinstall');
    expect(exitCode).toBe(0);
  });

  it('does not log override message for package.json scripts not in registry', () => {
    const { stdout, exitCode } = runNmr('postinstall');
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain('Using override script');
  });

  describe('override script messages', () => {
    let tempRoot: string;
    let overridePkgDir: string;
    let noopPkgDir: string;

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
    });

    afterAll(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('includes package name in override-script message', () => {
      const { stdout } = runNmr('build', { cwd: overridePkgDir });
      expect(stdout).toContain('📦 test-override: Using override script: echo ok');
    });

    it('logs no-op message for colon override', () => {
      const { stdout, exitCode } = runNmr('build', { cwd: noopPkgDir });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('⛔ test-noop: Override script is a no-op. Skipping.');
    });

    it('suppresses override-script message in quiet mode', () => {
      const { stdout } = runNmr('--quiet build', { cwd: overridePkgDir });
      expect(stdout).not.toContain('Using override script');
    });
  });

  describe('NMR_RUN_IF_PRESENT', () => {
    it('exits 0 for unknown command when set', () => {
      const { exitCode, stderr } = runNmr('nonexistent-command', {
        env: { NMR_RUN_IF_PRESENT: '1' },
      });
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
    });

    it('still exits 1 for unknown command when not set', () => {
      const { exitCode } = runNmr('nonexistent-command');
      expect(exitCode).toBe(1);
    });
  });

  describe('--quiet flag', () => {
    it('accepts -q flag without parse errors', () => {
      const { stdout, exitCode } = runNmr('-q --help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: nmr');
    });

    it('accepts --quiet flag without parse errors', () => {
      const { stdout, exitCode } = runNmr('--quiet --help');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage: nmr');
    });

    it('shows -q, --quiet in help output', () => {
      const { stdout } = runNmr('--help');
      expect(stdout).toContain('-q, --quiet');
    });

    it('suppresses output on successful command in quiet mode', () => {
      const { stdout, stderr, exitCode } = runNmr('-q typecheck', { cwd: NMR_PACKAGE_DIR });
      expect(exitCode).toBe(0);
      expect(stdout).toBe('');
      expect(stderr).toBe('');
    });

    it('still exits with error for unknown command when quiet', () => {
      const { stderr, exitCode } = runNmr('--quiet nonexistent-command');
      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unknown command');
    });
  });

  describe('pre/post hooks', () => {
    let tempRoot: string;
    let logFile: string;

    /**
     * Writes a workspace package whose scripts append a marker line to a log file
     * when invoked. The `clean` script is overridden because clean is in the default
     * registry (so resolving it triggers the override path), and we layer hook
     * scripts on top in tier-3 (package.json) where appropriate.
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

    it('runs pre and post hooks around the main command', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
    });

    it('runs pre-only hook when post is undefined', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'main']);
    });

    it('runs post-only hook when pre is undefined', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
    });

    it('is a silent no-op when no hooks are defined', () => {
      const pkgDir = path.join(tempRoot, 'packages', 'no-hooks');
      writePackage(pkgDir, { clean: `echo main >> ${logFile}` }, 'no-hooks');
      clearLog();

      const { exitCode, stderr } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main']);
      expect(stderr).toBe('');
    });

    it('short-circuits when pre-hook fails — main and post do not run', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(7);
      expect(readLog()).toStrictEqual(['pre']);
    });

    it('short-circuits when main fails — post does not run', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(5);
      expect(readLog()).toStrictEqual(['pre', 'main']);
    });

    it('propagates the exit code when post-hook fails', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(9);
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
    });

    it('runs hooks when the main command is overridden in package.json', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'override-main', 'post']);
    });

    it('directly invokes the pre hook without cascading', () => {
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

      const { exitCode, stderr } = runNmr('clean:pre', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      // Only the pre hook itself should run — no cascading attempt to find pre:pre/pre:post
      expect(readLog()).toStrictEqual(['pre']);
      expect(stderr).not.toContain('Unknown command');
    });

    it('directly invokes the post hook without cascading', () => {
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

      const { exitCode, stderr } = runNmr('clean:post', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['post']);
      expect(stderr).not.toContain('Unknown command');
    });

    it('attaches passthrough args to the main command only', () => {
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

      const { exitCode } = runNmr('clean --flag value', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre args=', 'main args=--flag value', 'post args=']);
    });

    it('skips hooks when main command is overridden to empty string', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual([]);
    });

    it('skips hooks when main command is overridden to colon', () => {
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

      const { exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual([]);
    });

    it('treats empty-string hook as silent no-op', () => {
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

      const { stdout, exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
      // No "Skipping" message should appear for the hook
      expect(stdout).not.toContain('Skipping');
    });

    it('treats colon-valued hook as silent no-op', () => {
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

      const { stdout, exitCode } = runNmr('clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
      expect(stdout).not.toContain('no-op');
    });

    it('suppresses hook chain output under --quiet', () => {
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

      const { stdout, exitCode } = runNmr('-q clean', { cwd: pkgDir });
      expect(exitCode).toBe(0);
      // Log proves the full chain ran
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
      // -q suppresses all stdout from the chain
      expect(stdout).toBe('');
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

        // Root package.json scripts are tier 3 from root cwd; under -w from a
        // subpackage they should resolve via root's package.json, not the
        // subpackage's. Defining wpkg-cmd here exercises that path.
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
        const configContent = `import { defineConfig } from '${NMR_PACKAGE_DIR}/dist/esm/index.js';
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

      it('runs hooks when main command is overridden in package.json (composite pre)', () => {
        clearConfigLog();
        const { exitCode } = runNmr('clean', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        // composite pre-hook expands to nmr cfg-pre-step1 && nmr cfg-pre-step2
        expect(readConfigLog()).toStrictEqual(['step1', 'step2', 'main', 'cfg-post']);
      });

      it('propagates -w to hook subprocesses so they resolve via root registry', () => {
        clearConfigLog();
        // wroot-cmd and its hooks live only in rootScripts. Without -w propagation,
        // the parent's `useRoot=true` decision is lost in the subprocess `nmr X:pre` call,
        // and the child re-derives a workspace registry from the package cwd, failing to
        // resolve the hook.
        const { exitCode } = runNmr('-w wroot-cmd', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wroot-pre', 'wroot-main', 'wroot-post']);
      });

      it('propagates -w through composite-script step subprocesses', () => {
        clearConfigLog();
        // wroot-composite and its steps live only in rootScripts. The composite expands
        // to `nmr -w wroot-step1 && nmr -w wroot-step2` so each child resolves via the
        // root registry. Without -w propagation in expandScript, the children re-derive
        // a workspace registry from the package cwd and fail with "Unknown command".
        const { exitCode } = runNmr('-w wroot-composite', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wroot-step1', 'wroot-step2']);
      });

      it('resolves tier-3 (root package.json) scripts under -w from a subpackage', () => {
        clearConfigLog();
        // wpkg-cmd and its hooks live only in the root package.json scripts (tier 3
        // from root cwd). Under -w from a subpackage, packageDir must follow useRoot
        // so the resolver consults root's package.json instead of the subpackage's,
        // otherwise the command and its hooks fail with "Unknown command".
        const { exitCode } = runNmr('-w wpkg-cmd', { cwd: configPkgDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wpkg-pre', 'wpkg-main', 'wpkg-post']);
      });
    });
  });
});
