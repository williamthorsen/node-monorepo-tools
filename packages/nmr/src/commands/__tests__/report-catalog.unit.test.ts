import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportCatalog } from '../report-catalog.ts';

describe(reportCatalog, () => {
  let monorepoRoot: string;

  beforeEach(() => {
    monorepoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-report-catalog-test-')));
    writeWorkspaceManifest();
  });

  afterEach(() => {
    fs.rmSync(monorepoRoot, { recursive: true });
    vi.restoreAllMocks();
  });

  it('names every catalogued dependency, its specifier, and the root a covering pass runs from', () => {
    const packageDir = writePackage('a', {
      dependencies: { zod: 'catalog:', semver: '7.5.0' },
      devDependencies: { lodash: 'catalog:legacy' },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportCatalog(packageDir);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2 dependencies come from a catalog'));
    expect(warnSpy).toHaveBeenCalledWith('- lodash → catalog:legacy');
    expect(warnSpy).toHaveBeenCalledWith('- zod → catalog:');
    expect(warnSpy).toHaveBeenCalledWith(`Run \`nmr upgrade\` from ${monorepoRoot} to include them.`);
  });

  it('names an uncatalogued dependency nowhere in the report', () => {
    const packageDir = writePackage('a', { dependencies: { zod: 'catalog:', semver: '7.5.0' } });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportCatalog(packageDir);

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('semver'));
  });

  it('recognizes the catalog protocol in every field that carries a specifier', () => {
    const packageDir = writePackage('a', {
      dependencies: { zod: 'catalog:' },
      devDependencies: { vitest: 'catalog:default' },
      optionalDependencies: { fsevents: 'catalog:' },
      peerDependencies: { typescript: 'catalog:tooling' },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportCatalog(packageDir);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('4 dependencies come from a catalog'));
    expect(warnSpy).toHaveBeenCalledWith('- typescript → catalog:tooling');
    expect(warnSpy).toHaveBeenCalledWith('- vitest → catalog:default');
  });

  it('reports a dependency declared in two fields once', () => {
    const packageDir = writePackage('a', {
      devDependencies: { typescript: 'catalog:' },
      peerDependencies: { typescript: 'catalog:' },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportCatalog(packageDir);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 dependency comes from a catalog'));
    expect(warnSpy.mock.calls.filter(([line]) => String(line).includes('typescript'))).toHaveLength(1);
  });

  it('says nothing when the package declares no catalogued dependency', () => {
    const packageDir = writePackage('a', { dependencies: { semver: '7.5.0' } });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportCatalog(packageDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('says nothing when the pass runs at the monorepo root', () => {
    writePackage('a', { dependencies: { zod: 'catalog:' } });
    fs.writeFileSync(path.join(monorepoRoot, 'package.json'), JSON.stringify({ name: 'root', private: true }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportCatalog(monorepoRoot);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('says nothing when the directory is outside every declared workspace package', () => {
    const outsideDir = path.join(monorepoRoot, 'tools');
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(outsideDir, 'package.json'), JSON.stringify({ dependencies: { zod: 'catalog:' } }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportCatalog(outsideDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  // region | Helpers

  /** Writes a workspace package declaring the given manifest fields, and returns its directory. */
  function writePackage(name: string, fields: Record<string, Record<string, string>>): string {
    const packageDir = path.join(monorepoRoot, 'packages', name);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, ...fields }));
    return packageDir;
  }

  /** Writes the manifest whose presence marks the temp directory as a monorepo root. */
  function writeWorkspaceManifest(): void {
    fs.writeFileSync(path.join(monorepoRoot, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  }

  // endregion | Helpers
});
