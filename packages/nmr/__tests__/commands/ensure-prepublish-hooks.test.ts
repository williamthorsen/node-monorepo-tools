import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensurePrepublishHooks } from '../../src/commands/ensure-prepublish-hooks.js';
import { readPackageJson } from '../../src/helpers/package-json.js';

/**
 * Create a minimal monorepo fixture with a pnpm-workspace.yaml
 * and the given packages under a `packages/` directory.
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
    if (pkg.private) pkgJson.private = true;
    if (pkg.prepublishOnly) {
      pkgJson.scripts = { prepublishOnly: pkg.prepublishOnly };
    }

    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');
  }
}

describe('ensurePrepublishHooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-prepublish-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('check mode', () => {
    it('reports ok when all non-private packages have prepublishOnly', () => {
      createFixture(tmpDir, [
        { name: '@scope/lib-a', prepublishOnly: 'pnpm run build' },
        { name: '@scope/lib-b', prepublishOnly: 'npm run compile' },
      ]);

      const result = ensurePrepublishHooks(tmpDir, { fix: false, dryRun: false });

      expect(result.hasFailures).toBe(false);
      expect(result.packages).toHaveLength(2);
      expect(result.packages.every((p) => p.action === 'ok')).toBe(true);
    });

    it('reports missing when a non-private package lacks prepublishOnly', () => {
      createFixture(tmpDir, [{ name: '@scope/lib-a', prepublishOnly: 'pnpm run build' }, { name: '@scope/lib-b' }]);

      const result = ensurePrepublishHooks(tmpDir, { fix: false, dryRun: false });

      expect(result.hasFailures).toBe(true);
      const missing = result.packages.filter((p) => p.action === 'missing');
      expect(missing).toHaveLength(1);
      expect(missing[0].packageName).toBe('@scope/lib-b');
    });

    it('skips private packages', () => {
      createFixture(tmpDir, [
        { name: '@scope/private-pkg', private: true },
        { name: '@scope/public-pkg', prepublishOnly: 'pnpm run build' },
      ]);

      const result = ensurePrepublishHooks(tmpDir, { fix: false, dryRun: false });

      expect(result.hasFailures).toBe(false);
      const privatePkg = result.packages.find((p) => p.packageName === '@scope/private-pkg');
      expect(privatePkg?.isPrivate).toBe(true);
      expect(privatePkg?.action).toBe('ok');
    });
  });

  describe('fix mode', () => {
    it('adds prepublishOnly to packages missing it', () => {
      createFixture(tmpDir, [{ name: '@scope/lib-a' }, { name: '@scope/lib-b', prepublishOnly: 'pnpm run build' }]);

      const result = ensurePrepublishHooks(tmpDir, { fix: true, dryRun: false });

      expect(result.hasFailures).toBe(false);
      const fixed = result.packages.find((p) => p.packageName === '@scope/lib-a');
      expect(fixed?.action).toBe('fixed');

      // Verify file was actually written
      const written = readPackageJson(path.join(tmpDir, 'packages', 'lib-a'));
      expect(written.scripts?.prepublishOnly).toBe('npm run build');
    });

    it('creates scripts object if missing', () => {
      createFixture(tmpDir, [{ name: '@scope/lib-a' }]);

      ensurePrepublishHooks(tmpDir, { fix: true, dryRun: false });

      const written = readPackageJson(path.join(tmpDir, 'packages', 'lib-a'));
      expect(written.scripts).toEqual({ prepublishOnly: 'npm run build' });
    });

    it('uses custom command when provided', () => {
      createFixture(tmpDir, [{ name: '@scope/lib-a' }]);

      ensurePrepublishHooks(tmpDir, { fix: true, dryRun: false, command: 'pnpm run build' });

      const written = readPackageJson(path.join(tmpDir, 'packages', 'lib-a'));
      expect(written.scripts?.prepublishOnly).toBe('pnpm run build');
    });

    it('does not modify private packages', () => {
      createFixture(tmpDir, [{ name: '@scope/private-pkg', private: true }]);

      const result = ensurePrepublishHooks(tmpDir, { fix: true, dryRun: false });

      expect(result.packages[0].action).toBe('ok');
    });
  });

  describe('dry-run mode', () => {
    it('reports would-fix without writing files', () => {
      createFixture(tmpDir, [{ name: '@scope/lib-a' }]);

      const result = ensurePrepublishHooks(tmpDir, { fix: true, dryRun: true });

      expect(result.hasFailures).toBe(false);
      expect(result.packages[0].action).toBe('would-fix');

      // Verify file was NOT written
      const raw = readPackageJson(path.join(tmpDir, 'packages', 'lib-a'));
      expect(raw.scripts).toBeUndefined();
    });
  });
});
