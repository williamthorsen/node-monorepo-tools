import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportOverrides } from '../report-overrides.ts';

describe(reportOverrides, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmr-report-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it('does nothing when no overrides exist', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports active pnpm overrides', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { 'some-package': '1.2.3' } },
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pnpm overrides are active'));
    expect(warnSpy).toHaveBeenCalledWith('- some-package → 1.2.3 (package.json)');
  });

  it('reports overrides declared in pnpm-workspace.yaml', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  some-package: 1.2.3\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).toHaveBeenCalledWith('- some-package → 1.2.3 (pnpm-workspace.yaml)');
  });

  it('names the declaration site of every override when both files carry one', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { 'legacy-package': '0.1.0' } },
    });
    writeWorkspaceManifest('overrides:\n  current-package: 2.0.0\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).toHaveBeenCalledWith('- legacy-package → 0.1.0 (package.json)');
    expect(warnSpy).toHaveBeenCalledWith('- current-package → 2.0.0 (pnpm-workspace.yaml)');
  });

  it('does nothing when overrides object is empty', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: {} },
    });
    writeWorkspaceManifest('packages:\n  - packages/*\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  // region | Helpers

  /** Writes the monorepo root's `package.json`. */
  function writePackageJson(pkg: Record<string, unknown>): void {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg));
  }

  /** Writes the monorepo root's `pnpm-workspace.yaml`. */
  function writeWorkspaceManifest(content: string): void {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), content);
  }

  // endregion | Helpers
});
