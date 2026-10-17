/* eslint-disable no-restricted-syntax -- this suite does not use a tree, managing its temporary directories by hand until #622 converts it. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeLogHelpers, NMR_PACKAGE_DIR, runNmr, warmBin } from '../test-utils/nmr-bin-harness.ts';

describe('nmr CLI', () => {
  // Warm the bin once per file, so that the hook subprocesses (`nmr X:pre`, `nmr X:post`) start cold once per file
  // rather than once per `it`.
  beforeAll(() => {
    warmBin();
  });

  describe('pre/post hooks', () => {
    let tempRoot: string;
    let logFile: string;

    /**
     * Writes a workspace package manifest that declares `scripts`. The tests override `clean`, which the default
     * registry defines, so that resolving it takes the override path, and declare its hooks beside it in tier 3.
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
      const packageDir = path.join(tempRoot, 'packages', 'both-hooks');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'both-hooks',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
    });

    it('runs pre-only hook when post is undefined', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'pre-only');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
        },
        'pre-only',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'main']);
    });

    it('runs post-only hook when pre is undefined', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'post-only');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'post-only',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
    });

    it('is a silent no-op when the package does not define any hooks', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'no-hooks');
      writePackage(packageDir, { clean: `echo main >> ${logFile}` }, 'no-hooks');
      clearLog();

      const { exitCode, stderr } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main']);
      expect(stderr).toBe('');
    });

    it('short-circuits when pre-hook fails; main and post do not run', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'pre-fails');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile} && exit 7`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'pre-fails',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(7);
      expect(readLog()).toStrictEqual(['pre']);
    });

    it('short-circuits when main fails; post does not run', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'main-fails');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile} && exit 5`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'main-fails',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(5);
      expect(readLog()).toStrictEqual(['pre', 'main']);
    });

    it('propagates the exit code when post-hook fails', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'post-fails');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile} && exit 9`,
        },
        'post-fails',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(9);
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
    });

    it('runs hooks when the main command is overridden in package.json', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'override-main');
      writePackage(
        packageDir,
        {
          clean: `echo override-main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'override-main',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre', 'override-main', 'post']);
    });

    it('directly invokes the pre hook without cascading', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'direct-pre');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'direct-pre',
      );
      clearLog();

      const { exitCode, stderr } = await runNmr('clean:pre', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre']);
      expect(stderr).not.toContain('Unknown command');
    });

    it('directly invokes the post hook without cascading', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'direct-post');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'direct-post',
      );
      clearLog();

      const { exitCode, stderr } = await runNmr('clean:post', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['post']);
      expect(stderr).not.toContain('Unknown command');
    });

    it('attaches passthrough args to the main command only', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'passthrough');
      // Use a wrapper script to capture argv without shell-redirection ambiguities,
      // such as `>> file --flag` parsing as redirect + extra args.
      const captureScript = path.join(packageDir, 'capture.sh');
      writePackage(
        packageDir,
        {
          clean: `bash ${captureScript} main`,
          'clean:pre': `bash ${captureScript} pre`,
          'clean:post': `bash ${captureScript} post`,
        },
        'passthrough',
      );
      writeFileSync(captureScript, `#!/bin/bash\nlabel="$1"\nshift\necho "$label args=$*" >> ${logFile}\n`);
      clearLog();

      const { exitCode } = await runNmr('clean --flag value', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['pre args=', 'main args=--flag value', 'post args=']);
    });

    it('skips hooks when main command is overridden to empty string', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'main-skip-empty');
      writePackage(
        packageDir,
        {
          clean: '',
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'main-skip-empty',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual([]);
    });

    it('skips hooks when main command is overridden to colon', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'main-skip-colon');
      writePackage(
        packageDir,
        {
          clean: ':',
          'clean:pre': `echo pre >> ${logFile}`,
          'clean:post': `echo post >> ${logFile}`,
        },
        'main-skip-colon',
      );
      clearLog();

      const { exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual([]);
    });

    it('treats empty-string hook as silent no-op', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'hook-skip-empty');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': '',
          'clean:post': `echo post >> ${logFile}`,
        },
        'hook-skip-empty',
      );
      clearLog();

      const { stdout, exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
      expect(stdout).not.toContain('Skipping');
    });

    it('treats colon-valued hook as silent no-op', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'hook-skip-colon');
      writePackage(
        packageDir,
        {
          clean: `echo main >> ${logFile}`,
          'clean:pre': ':',
          'clean:post': `echo post >> ${logFile}`,
        },
        'hook-skip-colon',
      );
      clearLog();

      const { stdout, exitCode } = await runNmr('clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      expect(readLog()).toStrictEqual(['main', 'post']);
      expect(stdout).not.toContain('no-op');
    });

    it('suppresses hook chain output under --quiet', async () => {
      const packageDir = path.join(tempRoot, 'packages', 'quiet-hooks');
      writePackage(
        packageDir,
        {
          clean: `echo main-noise && echo main >> ${logFile}`,
          'clean:pre': `echo pre-noise && echo pre >> ${logFile}`,
          'clean:post': `echo post-noise && echo post >> ${logFile}`,
        },
        'quiet-hooks',
      );
      clearLog();

      const { stdout, exitCode } = await runNmr('-q clean', { cwd: packageDir });
      expect(exitCode).toBe(0);
      // Log proves the full chain ran
      expect(readLog()).toStrictEqual(['pre', 'main', 'post']);
      expect(stdout).not.toContain('noise');
      // Each hook is a leaf of the chain on which `clean` reports, so one verdict covers all three.
      expect(stdout.split('\n').filter((line) => line.length > 0)).toHaveLength(1);
    });

    describe('config-defined hooks', () => {
      let configRoot: string;
      let configPackageDir: string;
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

        // Composite hook (array): Only allowed in tier 1+2, so requires .config/nmr.config.ts.
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

        configPackageDir = path.join(configRoot, 'packages', 'cfg-pkg');
        mkdirSync(configPackageDir, { recursive: true });
        writeFileSync(
          path.join(configPackageDir, 'package.json'),
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
        const { exitCode } = await runNmr('clean', { cwd: configPackageDir });
        expect(exitCode).toBe(0);
        // composite pre-hook expands to nmr cfg-pre-step1 && nmr cfg-pre-step2
        expect(readConfigLog()).toStrictEqual(['step1', 'step2', 'main', 'cfg-post']);
      });

      it('propagates -w to hook subprocesses so that they resolve via root registry', async () => {
        clearConfigLog();
        // wroot-cmd and its hooks live only in rootScripts. Without -w propagation,
        // the parent's `shouldUseRoot=true` decision is lost in the subprocess `nmr X:pre` call,
        // and the child re-derives a workspace registry from the package cwd, failing to resolve the hook.
        const { exitCode } = await runNmr('-w wroot-cmd', { cwd: configPackageDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wroot-pre', 'wroot-main', 'wroot-post']);
      });

      it('propagates -w through composite-script step subprocesses', async () => {
        clearConfigLog();
        // wroot-composite and its steps live only in rootScripts. The composite expands to `nmr -w wroot-step1 && nmr
        // -w wroot-step2` so that each child resolves via the root registry. Without -w propagation in expandScript,
        // the children re-derive a workspace registry from the package cwd and fail with "Unknown command".
        const { exitCode } = await runNmr('-w wroot-composite', { cwd: configPackageDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wroot-step1', 'wroot-step2']);
      });

      // Reaches `shouldUseRoot` through `context.isRoot` rather than through the `-w` flag, the other disjunct in
      // `runCli.ts`. This is the path that an ordinary root `package.json` script takes.
      it('resolves tier-3 (root package.json) scripts at the monorepo root', async () => {
        clearConfigLog();
        const { exitCode } = await runNmr('wpkg-cmd', { cwd: configRoot });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wpkg-pre', 'wpkg-main', 'wpkg-post']);
      });

      it('resolves tier-3 (root package.json) scripts under -w from a subpackage', async () => {
        clearConfigLog();
        // wpkg-cmd and its hooks live only in the root package.json scripts (tier 3 from root cwd).
        // Under -w from a subpackage, packageDir must follow shouldUseRoot so that the resolver consults root's
        // package.json instead of the subpackage's, otherwise the command and its hooks fail with "Unknown command".
        const { stdout, exitCode } = await runNmr('-w wpkg-cmd', { cwd: configPackageDir });
        expect(exitCode).toBe(0);
        expect(readConfigLog()).toStrictEqual(['wpkg-pre', 'wpkg-main', 'wpkg-post']);
        // wpkg-cmd is not in any registry, so the override-script message is suppressed: It announces a
        // package.json script that *replaces* a built-in, not every tier-3 entry that happens to resolve.
        expect(stdout).not.toContain('Using override script');
      });
    });
  });
});
