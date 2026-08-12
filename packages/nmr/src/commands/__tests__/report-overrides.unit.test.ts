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

  it('reports the overrides declared in pnpm-workspace.yaml', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  some-package: 1.2.3\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pnpm overrides are active'));
    expect(warnSpy).toHaveBeenCalledWith('- some-package → 1.2.3');
  });

  // YAML's implicit typing turns an unquoted version into a number, which must not cost the entries beside it.
  it('keeps the string entries of a workspace block carrying a non-string value', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('overrides:\n  react: 18\n  node-fetch: 2.6.7\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).toHaveBeenCalledWith('- node-fetch → 2.6.7');
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('react'));
  });

  it('does nothing when the workspace overrides block is empty', () => {
    writePackageJson({ name: 'test', version: '1.0.0' });
    writeWorkspaceManifest('packages:\n  - packages/*\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('rejects a pnpm.overrides block, naming every entry and the remedy', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { 'some-package': '1.2.3', 'other-package': '4.5.6' } },
    });

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => reportOverrides(tmpDir)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('- some-package → 1.2.3'),
        name: 'UserError',
      }),
    );
    expect(() => reportOverrides(tmpDir)).toThrow(/other-package → 4\.5\.6/);
    expect(() => reportOverrides(tmpDir)).toThrow(/pnpm-workspace\.yaml/);
  });

  it('accepts an empty pnpm.overrides block', () => {
    writePackageJson({ name: 'test', version: '1.0.0', pnpm: { overrides: {} } });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reportOverrides(tmpDir);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('reports the supported site before rejecting the legacy one', () => {
    writePackageJson({
      name: 'test',
      version: '1.0.0',
      pnpm: { overrides: { 'legacy-package': '0.1.0' } },
    });
    writeWorkspaceManifest('overrides:\n  current-package: 2.0.0\n');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => reportOverrides(tmpDir)).toThrow(/legacy-package/);
    expect(warnSpy).toHaveBeenCalledWith('- current-package → 2.0.0');
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
