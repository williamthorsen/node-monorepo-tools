import fs from 'node:fs';
import path from 'node:path';

import { createTempTree } from '@williamthorsen/toolbelt.filesystem/candidate';
import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { makeFixture } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it as baseIt } from 'vitest';

import { readPackageJson } from '../../helpers/package-json.ts';
import type { EnsurePrepublishHooksResult, PackageHookStatus } from '../ensure-prepublish-hooks.ts';
import { DEFAULT_HOOK, ensurePrepublishHooks, reportPrepublishHooks } from '../ensure-prepublish-hooks.ts';

// eslint-disable-next-line vitest/consistent-test-it -- the rule reads this builder call as a top-level test.
const it = baseIt.extend(
  'tree',
  makeFixture(() => createTempTree({}, { prefix: 'nmr-prepublish-test-' })),
);

describe(ensurePrepublishHooks, () => {
  describe('check mode', () => {
    it('reports ok when all non-private packages have prepublishOnly', ({ tree }) => {
      createFixture(tree.dir, [
        { name: '@scope/lib-a', prepublishOnly: 'pnpm run build' },
        { name: '@scope/lib-b', prepublishOnly: 'npm run compile' },
      ]);

      const result = ensurePrepublishHooks(tree.dir, { fix: false, dryRun: false });

      expect(result.hasFailures).toBe(false);
      expect(result.packages).toHaveLength(2);
      expect(result.packages.every((p) => p.action === 'ok')).toBe(true);
    });

    it('reports missing when a non-private package lacks prepublishOnly', ({ tree }) => {
      createFixture(tree.dir, [{ name: '@scope/lib-a', prepublishOnly: 'pnpm run build' }, { name: '@scope/lib-b' }]);

      const result = ensurePrepublishHooks(tree.dir, { fix: false, dryRun: false });

      expect(result.hasFailures).toBe(true);
      const missing = result.packages.filter((p) => p.action === 'missing');
      expect(missing).toHaveLength(1);
      expect(missing[0]?.packageName).toBe('@scope/lib-b');
    });

    it('skips private packages', ({ tree }) => {
      createFixture(tree.dir, [
        { name: '@scope/private-pkg', private: true },
        { name: '@scope/public-pkg', prepublishOnly: 'pnpm run build' },
      ]);

      const result = ensurePrepublishHooks(tree.dir, { fix: false, dryRun: false });

      expect(result.hasFailures).toBe(false);
      const privatePkg = result.packages.find((p) => p.packageName === '@scope/private-pkg');
      expect(privatePkg?.isPrivate).toBe(true);
      expect(privatePkg?.action).toBe('ok');
    });
  });

  describe('fix mode', () => {
    it('adds prepublishOnly to packages missing it', ({ tree }) => {
      createFixture(tree.dir, [{ name: '@scope/lib-a' }, { name: '@scope/lib-b', prepublishOnly: 'pnpm run build' }]);

      const result = ensurePrepublishHooks(tree.dir, { fix: true, dryRun: false });

      expect(result.hasFailures).toBe(false);
      const fixed = result.packages.find((p) => p.packageName === '@scope/lib-a');
      expect(fixed?.action).toBe('fixed');

      // Verify file was actually written
      const written = readPackageJson(path.join(tree.dir, 'packages', 'lib-a'));
      expect(written.scripts?.['prepublishOnly']).toBe('npm run build');
    });

    it('creates scripts object if missing', ({ tree }) => {
      createFixture(tree.dir, [{ name: '@scope/lib-a' }]);

      ensurePrepublishHooks(tree.dir, { fix: true, dryRun: false });

      const written = readPackageJson(path.join(tree.dir, 'packages', 'lib-a'));
      expect(written.scripts).toStrictEqual({ prepublishOnly: 'npm run build' });
    });

    it('uses custom command when provided', ({ tree }) => {
      createFixture(tree.dir, [{ name: '@scope/lib-a' }]);

      ensurePrepublishHooks(tree.dir, { fix: true, dryRun: false, command: 'pnpm run build' });

      const written = readPackageJson(path.join(tree.dir, 'packages', 'lib-a'));
      expect(written.scripts?.['prepublishOnly']).toBe('pnpm run build');
    });

    it('does not modify private packages', ({ tree }) => {
      createFixture(tree.dir, [{ name: '@scope/private-pkg', private: true }]);

      const result = ensurePrepublishHooks(tree.dir, { fix: true, dryRun: false });

      expect(result.packages[0]?.action).toBe('ok');
    });
  });

  describe('dry-run mode', () => {
    it('reports would-fix without writing files', ({ tree }) => {
      createFixture(tree.dir, [{ name: '@scope/lib-a' }]);

      const result = ensurePrepublishHooks(tree.dir, { fix: true, dryRun: true });

      expect(result.hasFailures).toBe(false);
      expect(result.packages[0]?.action).toBe('would-fix');

      // Verify file was NOT written
      const raw = readPackageJson(path.join(tree.dir, 'packages', 'lib-a'));
      expect(raw.scripts).toBeUndefined();
    });
  });
});

describe(reportPrepublishHooks, () => {
  it('closes a clean run with the count of packages carrying the hook', () => {
    using silent = silenceConsole(['info']);

    reportPrepublishHooks(buildResult([status('a', 'ok'), status('b', 'ok'), status('c', 'ok')]), DEFAULT_HOOK);

    expect(silent.info).toHaveBeenCalledWith('\n3 publishable packages have prepublishOnly.');
  });

  it('closes a run with a miss by naming how many of them there are', () => {
    using silent = silenceConsole(['info']);

    reportPrepublishHooks(buildResult([status('a', 'ok'), status('b', 'missing')]), DEFAULT_HOOK);

    expect(silent.info).toHaveBeenCalledWith(
      '\n1 of 2 publishable packages is missing prepublishOnly. Run with --fix to add it.',
    );
  });

  it('closes a fix run with what it added', () => {
    using silent = silenceConsole(['info']);

    reportPrepublishHooks(buildResult([status('a', 'fixed'), status('b', 'ok')]), DEFAULT_HOOK);

    expect(silent.info).toHaveBeenCalledWith('\nAdded prepublishOnly to 1 of 2 publishable packages.');
  });

  it('closes a dry run with what it would add', () => {
    using silent = silenceConsole(['info']);

    reportPrepublishHooks(buildResult([status('a', 'would-fix')]), DEFAULT_HOOK);

    expect(silent.info).toHaveBeenCalledWith('\nWould add prepublishOnly to 1 of 1 publishable package.');
  });

  it('closes a workspace of private packages with the one statement its output is', () => {
    using silent = silenceConsole(['info']);

    reportPrepublishHooks(buildResult([{ ...status('a', 'ok'), isPrivate: true }]), DEFAULT_HOOK);

    expect(silent.info).toHaveBeenCalledExactlyOnceWith('No publishable packages found.');
  });

  it('reports a miss on the stream its other lines went to, leaving the failure to the exit code', () => {
    using silent = silenceConsole(['info', 'warn']);

    reportPrepublishHooks(buildResult([status('a', 'ok'), status('b', 'missing')]), DEFAULT_HOOK);

    expect(silent.info).toHaveBeenCalledWith('✗ b: missing prepublishOnly');
    expect(silent.warn).not.toHaveBeenCalled();
  });
});

// region | Helpers

/** Wraps package statuses as the result a run hands to the reporter. */
function buildResult(packages: PackageHookStatus[]): EnsurePrepublishHooksResult {
  return { packages, hasFailures: packages.some((pkg) => pkg.action === 'missing') };
}

/**
 * Create a minimal monorepo fixture with a pnpm-workspace.yaml and the given packages under a `packages/` directory.
 */
function createFixture(
  tmpDir: string,
  packages: Array<{ name: string; private?: boolean; prepublishOnly?: string }>,
): void {
  fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', private: true }));

  const packagesDir = path.join(tmpDir, 'packages');
  fs.mkdirSync(packagesDir);

  for (const pkg of packages) {
    const dirName = pkg.name.replace(/^@[^/]+\//, '');
    const pkgDir = path.join(packagesDir, dirName);
    fs.mkdirSync(pkgDir);

    const pkgJson: Record<string, unknown> = { name: pkg.name, version: '1.0.0' };
    if (pkg.private) pkgJson['private'] = true;
    if (pkg.prepublishOnly) {
      pkgJson['scripts'] = { prepublishOnly: pkg.prepublishOnly };
    }

    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');
  }
}

/** Builds one package's status, with the hook present exactly when the action says it is. */
function status(packageName: string, action: PackageHookStatus['action']): PackageHookStatus {
  return {
    packageName,
    packageDir: `/packages/${packageName}`,
    isPrivate: false,
    prepublishOnly: action === 'ok' ? DEFAULT_HOOK : undefined,
    action,
  };
}

// endregion | Helpers
