import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assertTarballsComplete } from '../assertTarballsComplete.ts';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock(import('../detectPackageManager.ts'), () => ({
  detectPackageManager: () => 'pnpm',
}));

const MANIFESTS: Record<string, unknown> = {
  'packages/complete/package.json': { name: '@scope/complete', exports: { '.': './dist/index.js' } },
  'packages/incomplete/package.json': {
    name: '@scope/incomplete',
    bin: './bin/cli.js',
    exports: { '.': { types: './dist/index.d.ts', 'nmr-source': './src/index.ts', import: './dist/index.js' } },
  },
  'packages/internal/package.json': { name: '@scope/internal', private: true, main: './dist/index.js' },
};

const PACKED_FILES: Record<string, string[]> = {
  'packages/complete': ['package.json', 'dist/index.js'],
  'packages/incomplete': ['package.json', 'bin/cli.js'],
};

describe(assertTarballsComplete, () => {
  let stdioCapture: CapturedStdio;
  const pack = vi.fn((workspacePaths: readonly string[]) => {
    return new Map(workspacePaths.map((workspacePath) => [workspacePath, PACKED_FILES[workspacePath] ?? []]));
  });

  beforeEach(() => {
    stdioCapture = captureStdio();
    mockReadFileSync.mockImplementation((filePath: string) => {
      const manifest = MANIFESTS[filePath];
      if (manifest === undefined) {
        throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
      }
      return JSON.stringify(manifest);
    });
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    mockReadFileSync.mockReset();
    pack.mockClear();
  });

  it('passes when every tarball contains the files that its manifest names', () => {
    expect(() => assertTarballsComplete(['packages/complete'], [], pack)).not.toThrow();
    expect(pack).toHaveBeenCalledWith(['packages/complete'], 'pnpm');
    expect(stdioCapture.stderr).toContain('Checking the tarballs of 1 package from a clean checkout of HEAD');
  });

  it('names each incomplete package with each missing path and the manifest location that names it', () => {
    expect(() => assertTarballsComplete(['packages/complete', 'packages/incomplete'], ['nmr-source'], pack)).toThrow(
      [
        'Cannot release: The tarball of every package must contain each file that its manifest names.',
        '',
        '@scope/incomplete (packages/incomplete) lacks:',
        '  - ./dist/index.d.ts (exports["."].types)',
        '  - ./dist/index.js (exports["."].import)',
      ].join('\n'),
    );
  });

  it('checks a condition that the config does not list as a development condition', () => {
    expect(() => assertTarballsComplete(['packages/incomplete'], [], pack)).toThrow(
      './src/index.ts (exports["."].nmr-source)',
    );
  });

  it('does not pack a private package', () => {
    assertTarballsComplete(['packages/complete', 'packages/internal'], [], pack);

    expect(pack).toHaveBeenCalledWith(['packages/complete'], 'pnpm');
  });

  it('does not pack anything when no workspace is publishable', () => {
    assertTarballsComplete(['packages/internal'], [], pack);
    assertTarballsComplete([], [], pack);

    expect(pack).not.toHaveBeenCalled();
    expect(stdioCapture.stderr).toBe('');
  });

  it('refuses with the failing step when the packages cannot be packed', () => {
    const failingPack = vi.fn(() => {
      throw new Error('Could not install dependencies: `pnpm install` exited with status 1.');
    });

    expect(() => assertTarballsComplete(['packages/complete'], [], failingPack)).toThrow(
      'Cannot release: The packages could not be packed from a clean checkout of HEAD.\nCould not install dependencies',
    );
  });
});
