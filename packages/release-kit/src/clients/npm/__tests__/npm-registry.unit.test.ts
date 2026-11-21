import { describe, expect, it } from 'vitest';

import { makeFakeNpm } from '../../../test-utils/makeFakeNpm.ts';
import {
  buildNpmViewArgs,
  lookUpNpmPackage,
  lookUpNpmPackageVersion,
  type NpmErrorPayload,
  readNpmError,
} from '../npm-registry.ts';

describe(buildNpmViewArgs, () => {
  it('queries the default registry without revalidating the cache', () => {
    expect(buildNpmViewArgs('@scope/pkg', undefined, false)).toStrictEqual(['view', '@scope/pkg', 'version', '--json']);
  });

  it('revalidates the cache and queries the given registry', () => {
    expect(buildNpmViewArgs('@scope/pkg@1.2.3', 'https://npm.example.com/', true)).toStrictEqual([
      'view',
      '@scope/pkg@1.2.3',
      'version',
      '--json',
      '--prefer-online',
      '--registry',
      'https://npm.example.com/',
    ]);
  });
});

describe(lookUpNpmPackage, () => {
  it('reports a package that npm can view as published', () => {
    const npm = makeFakeNpm();

    expect(lookUpNpmPackage('@scope/pkg', undefined, npm)).toStrictEqual({ status: 'published' });
    expect(npm.viewVersion).toHaveBeenCalledExactlyOnceWith('@scope/pkg', undefined);
  });

  it('queries the given registry', () => {
    const npm = makeFakeNpm();

    lookUpNpmPackage('@scope/pkg', 'https://npm.example.com/', npm);

    expect(npm.viewVersion).toHaveBeenCalledExactlyOnceWith('@scope/pkg', 'https://npm.example.com/');
  });

  it('reports an E404 as unpublished', () => {
    const npm = makeFailingNpm({ code: 'E404', summary: 'Not Found - GET https://registry.npmjs.org/@scope%2fpkg' });

    expect(lookUpNpmPackage('@scope/pkg', undefined, npm)).toStrictEqual({ status: 'unpublished' });
  });

  it('reports an unreachable registry as unverifiable', () => {
    const npm = makeFailingNpm({ code: 'ENOTFOUND', summary: 'getaddrinfo ENOTFOUND registry.npmjs.org' });

    expect(lookUpNpmPackage('@scope/pkg', undefined, npm)).toStrictEqual({
      status: 'unverifiable',
      detail: 'Cannot reach the npm registry (ENOTFOUND)',
    });
  });

  it('reports a rejected session as unverifiable', () => {
    const npm = makeFailingNpm({ code: 'E401', summary: '401 Unauthorized' });

    expect(lookUpNpmPackage('@scope/pkg', undefined, npm)).toStrictEqual({
      status: 'unverifiable',
      detail: 'The npm registry rejected the session (E401)',
    });
  });

  it('reports any other npm error as unverifiable, with its code and summary', () => {
    const npm = makeFailingNpm({ code: 'E500', summary: 'Internal Server Error' });

    expect(lookUpNpmPackage('@scope/pkg', undefined, npm)).toStrictEqual({
      status: 'unverifiable',
      detail: 'The npm registry query failed (E500): Internal Server Error',
    });
  });

  it('reports a failure without a readable payload as unverifiable', () => {
    const npm = makeFailingNpm(undefined);

    expect(lookUpNpmPackage('@scope/pkg', undefined, npm)).toStrictEqual({
      status: 'unverifiable',
      detail: 'The npm registry query failed without a readable error payload',
    });
  });
});

describe(lookUpNpmPackageVersion, () => {
  it('reports a version that npm can view as published', () => {
    const npm = makeFakeNpm();

    expect(lookUpNpmPackageVersion('@scope/pkg', '1.2.3', 'https://npm.example.com/', npm)).toStrictEqual({
      status: 'published',
    });
    expect(npm.viewPackageVersion).toHaveBeenCalledExactlyOnceWith('@scope/pkg', '1.2.3', 'https://npm.example.com/');
  });

  it('reports a version that npm does not list as unpublished', () => {
    const npm = makeFakeNpm({
      viewPackageVersion: () => ({ ok: false, error: { code: 'E404', summary: 'No match found for version 1.2.3' } }),
    });

    expect(lookUpNpmPackageVersion('@scope/pkg', '1.2.3', undefined, npm)).toStrictEqual({ status: 'unpublished' });
  });
});

describe(readNpmError, () => {
  it("reads the code and summary of npm's error envelope", () => {
    const stdout = JSON.stringify({ error: { code: 'E404', summary: 'Not Found', detail: '' } });

    expect(readNpmError(stdout)).toStrictEqual({ code: 'E404', summary: 'Not Found' });
  });

  it('returns undefined when stdout is not JSON', () => {
    expect(readNpmError('npm error code E404')).toBeUndefined();
  });

  it('returns undefined when the error code is not a string', () => {
    expect(readNpmError(JSON.stringify({ error: { code: 404, summary: 'Not Found' } }))).toBeUndefined();
  });

  it('reads an empty summary when the summary is not a string', () => {
    expect(readNpmError(JSON.stringify({ error: { code: 'E500', summary: null } }))).toStrictEqual({
      code: 'E500',
      summary: '',
    });
  });
});

// region | Helpers

/** Builds an `Npm` whose query fails with `error` as its parsed envelope. */
function makeFailingNpm(error: NpmErrorPayload | undefined) {
  return makeFakeNpm({ viewVersion: () => ({ ok: false, error }) });
}

// endregion | Helpers
