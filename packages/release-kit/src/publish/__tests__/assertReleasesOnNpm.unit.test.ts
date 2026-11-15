import { UserError } from '@williamthorsen/nmr-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NpmViewResult } from '../../clients/npm/npm-registry.ts';
import { type FakeNpm, makeFakeNpm } from '../../test-utils/makeFakeNpm.ts';
import { assertReleasesOnNpm } from '../assertReleasesOnNpm.ts';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

const NOT_FOUND: NpmViewResult = { ok: false, error: { code: 'E404', summary: 'Not Found' } };

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
  let npm: FakeNpm;

  beforeEach(() => {
    mockReadFileSync.mockReset();
    mockReadFileSync.mockImplementation((filePath: string) => {
      const manifest = MANIFESTS[filePath];
      if (manifest === undefined) {
        throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
      }
      return JSON.stringify(manifest);
    });
    npm = makeFakeNpm();
  });

  it('passes when npm lists every publishable package', () => {
    expect(() => assertReleasesOnNpm(['packages/arrays', 'packages/strings'], npm)).not.toThrow();
    expect(npm.viewVersion).toHaveBeenCalledWith('@scope/arrays', undefined);
    expect(npm.viewVersion).toHaveBeenCalledWith('@scope/strings', undefined);
  });

  it('reads the root package.json for a single-package repo', () => {
    assertReleasesOnNpm(['.'], npm);

    expect(npm.viewVersion).toHaveBeenCalledWith('single', undefined);
  });

  it('does not call the registry when there are no workspaces to check', () => {
    assertReleasesOnNpm([], npm);

    expect(npm.viewVersion).not.toHaveBeenCalled();
  });

  it('does not look up a private package', () => {
    assertReleasesOnNpm(['packages/internal'], npm);

    expect(npm.viewVersion).not.toHaveBeenCalled();
  });

  it("queries the registry that the package's publishConfig names", () => {
    assertReleasesOnNpm(['packages/mirrored'], npm);

    expect(npm.viewVersion).toHaveBeenCalledWith('@scope/mirrored', 'https://npm.example.com/');
  });

  it('names each unpublished package with the command that publishes it', () => {
    npm.viewVersion.mockReturnValue(NOT_FOUND);

    expect(() => assertReleasesOnNpm(['packages/arrays', 'packages/strings'], npm)).toThrow(UserError);
    expect(() => assertReleasesOnNpm(['packages/arrays', 'packages/strings'], npm)).toThrow(
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
    npm.viewVersion.mockReturnValue({
      ok: false,
      error: { code: 'ENOTFOUND', summary: 'getaddrinfo ENOTFOUND registry.npmjs.org' },
    });

    const runAssertion = () => assertReleasesOnNpm(['packages/arrays'], npm);

    expect(runAssertion).toThrow(UserError);
    expect(runAssertion).toThrow(
      'Could not confirm on npm:\n  - @scope/arrays: Cannot reach the npm registry (ENOTFOUND)',
    );
    expect(runAssertion).not.toThrow('npm publish');
  });

  it('lists every failing package, unpublished and unconfirmed alike', () => {
    npm.viewVersion.mockImplementation((name): NpmViewResult =>
      name === '@scope/arrays' ? NOT_FOUND : { ok: false, error: { code: 'E500', summary: 'Internal Server Error' } },
    );

    const runAssertion = () => assertReleasesOnNpm(['packages/arrays', 'packages/strings'], npm);

    expect(runAssertion).toThrow(UserError);
    expect(runAssertion).toThrow('  - @scope/arrays: run "npm publish --access public" from packages/arrays');
    expect(runAssertion).toThrow('  - @scope/strings: The npm registry query failed (E500): Internal Server Error');
  });
});
