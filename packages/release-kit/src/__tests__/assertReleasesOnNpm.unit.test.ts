import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertReleasesOnNpm } from '../assertReleasesOnNpm.ts';
import type { NpmPackageLookup } from '../npmRegistry.ts';

const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockLookUpNpmPackage = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

vi.mock(import('../npmRegistry.ts'), () => ({
  lookUpNpmPackage: mockLookUpNpmPackage,
}));

const MANIFESTS: Record<string, unknown> = {
  'package.json': { name: 'single' },
  'packages/arrays/package.json': { name: '@scope/arrays' },
  'packages/internal/package.json': { name: '@scope/internal', private: true },
  'packages/mirrored/package.json': {
    name: '@scope/mirrored',
    publishConfig: { access: 'public', registry: 'https://npm.example.com/' },
  },
  'packages/strings/package.json': { name: '@scope/strings' },
};

describe(assertReleasesOnNpm, () => {
  beforeEach(() => {
    mockReadFileSync.mockReset();
    mockReadFileSync.mockImplementation((filePath: string) => {
      const manifest = MANIFESTS[filePath];
      if (manifest === undefined) {
        throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
      }
      return JSON.stringify(manifest);
    });
    mockLookUpNpmPackage.mockReset();
    mockLookUpNpmPackage.mockReturnValue({ status: 'published' } satisfies NpmPackageLookup);
  });

  it('passes when npm lists every publishable package', () => {
    expect(() => assertReleasesOnNpm(['packages/arrays', 'packages/strings'])).not.toThrow();
    expect(mockLookUpNpmPackage).toHaveBeenCalledWith('@scope/arrays', undefined);
    expect(mockLookUpNpmPackage).toHaveBeenCalledWith('@scope/strings', undefined);
  });

  it('reads the root package.json for a single-package repo', () => {
    assertReleasesOnNpm(['.']);

    expect(mockLookUpNpmPackage).toHaveBeenCalledWith('single', undefined);
  });

  it('does not call the registry when there are no workspaces to check', () => {
    assertReleasesOnNpm([]);

    expect(mockLookUpNpmPackage).not.toHaveBeenCalled();
  });

  it('does not look up a private package', () => {
    assertReleasesOnNpm(['packages/internal']);

    expect(mockLookUpNpmPackage).not.toHaveBeenCalled();
  });

  it("queries the registry that the package's publishConfig names", () => {
    assertReleasesOnNpm(['packages/mirrored']);

    expect(mockLookUpNpmPackage).toHaveBeenCalledWith('@scope/mirrored', 'https://npm.example.com/');
  });

  it('names each unpublished package with the command that publishes it', () => {
    mockLookUpNpmPackage.mockReturnValue({ status: 'unpublished' } satisfies NpmPackageLookup);

    expect(() => assertReleasesOnNpm(['packages/arrays', 'packages/strings'])).toThrow(
      [
        'Cannot prepare the release: npm must already have every package that the release publishes.',
        '',
        'Not on npm yet:',
        '  - @scope/arrays: run "npm publish --access public" from packages/arrays',
        '  - @scope/strings: run "npm publish --access public" from packages/strings',
        'Then register each one as a trusted publisher; "rdy run --from npm:@williamthorsen/release-kit npm-auto-publish" prints the command.',
      ].join('\n'),
    );
  });

  it('reports a package that it could not look up separately, without advising a publish', () => {
    mockLookUpNpmPackage.mockReturnValue({
      status: 'unverifiable',
      detail: 'Cannot reach the npm registry (ENOTFOUND)',
    } satisfies NpmPackageLookup);

    const action = () => assertReleasesOnNpm(['packages/arrays']);

    expect(action).toThrow('Could not confirm on npm:\n  - @scope/arrays: Cannot reach the npm registry (ENOTFOUND)');
    expect(action).not.toThrow('npm publish');
  });

  it('lists every failing package, unpublished and unconfirmed alike', () => {
    mockLookUpNpmPackage.mockImplementation((name: string): NpmPackageLookup =>
      name === '@scope/arrays' ? { status: 'unpublished' } : { status: 'unverifiable', detail: 'E500' },
    );

    const action = () => assertReleasesOnNpm(['packages/arrays', 'packages/strings']);

    expect(action).toThrow('  - @scope/arrays: run "npm publish --access public" from packages/arrays');
    expect(action).toThrow('  - @scope/strings: E500');
  });
});
