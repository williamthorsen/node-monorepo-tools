import { createTempTree } from '@williamthorsen/toolbelt.testing/candidate';
import { disposeOnTestFinished } from '@williamthorsen/toolbelt.vitest/candidate';
import { describe, expect, it } from 'vitest';

import { deriveDirectoryConfig } from '../deriveDirectoryConfig.ts';
import type { DeclaredDirectory } from '../resolveReleaseDeclaration.ts';

const VERSION_JSON = JSON.stringify({ version: '1.2.0' });

describe(deriveDirectoryConfig, () => {
  it('versions a directory without a package.json by its version.json and derives its tag prefix from its basename', () => {
    const root = makeTree({ 'apps/devopticon/version.json': VERSION_JSON, 'apps/devopticon/Package.swift': '' });

    expect(deriveDirectoryConfig(declare('app', 'apps/devopticon'), root)).toStrictEqual({
      name: 'app',
      path: 'apps/devopticon',
      versionFile: 'apps/devopticon/version.json',
      paths: ['apps/devopticon/**'],
      tagPrefix: 'devopticon-v',
    });
  });

  it("versions a directory by its package.json when it has one, ignoring the package's name", () => {
    const root = makeTree({
      'tools/gen/package.json': JSON.stringify({ name: '@scope/generator', version: '0.3.0' }),
    });

    expect(deriveDirectoryConfig(declare('gen', 'tools/gen'), root)).toMatchObject({
      versionFile: 'tools/gen/package.json',
      tagPrefix: 'gen-v',
    });
  });

  it('versions the repo root by the root package.json under the v prefix, reading the whole repo', () => {
    const root = makeTree({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });

    expect(deriveDirectoryConfig({ name: 'repo', path: '.' }, root)).toStrictEqual({
      name: 'repo',
      path: '.',
      versionFile: 'package.json',
      tagPrefix: 'v',
    });
  });

  it('keeps a configured tag prefix and the legacy identities', () => {
    const root = makeTree({ 'docs/version.json': VERSION_JSON });
    const legacyIdentities = [{ name: 'site', tagPrefix: 'site-v' }];

    expect(
      deriveDirectoryConfig({ ...declare('docs', 'docs'), tagPrefix: 'docs-site-v', legacyIdentities }, root),
    ).toMatchObject({ tagPrefix: 'docs-site-v', legacyIdentities });
  });

  it.each([
    [
      'a path that does not exist',
      {},
      'apps/missing',
      "releases.app: path 'apps/missing' is not a directory; declare a directory that exists in the repo",
    ],
    [
      'a path that is a file',
      { 'apps/app': '' },
      'apps/app',
      "releases.app: path 'apps/app' is not a directory; declare a directory that exists in the repo",
    ],
    [
      'a directory without a version file',
      { 'apps/app/main.go': '' },
      'apps/app',
      'releases.app: apps/app/version.json not found; create it with the directory\'s current version, such as { "version": "0.0.0" }',
    ],
    [
      'a version file without a version',
      { 'apps/app/version.json': JSON.stringify({ name: 'app' }) },
      'apps/app',
      "releases.app: apps/app/version.json does not contain a string 'version' field; add one",
    ],
    [
      'a basename that cannot form a tag prefix',
      { 'apps/My App/version.json': VERSION_JSON },
      'apps/My App',
      "releases.app: the directory name 'My App' cannot form a tag prefix; set tagPrefix, such as 'My-App-v'",
    ],
  ])('rejects %s', (_description, entries, directoryPath, message) => {
    const root = makeTree(entries);

    expect(() => deriveDirectoryConfig(declare('app', directoryPath), root)).toThrow(message);
  });
});

// region | Helpers

/** Declares the directory at `directoryPath` under `name`, with the window that `resolveReleaseDeclaration` gives it. */
function declare(name: string, directoryPath: string): DeclaredDirectory {
  return { name, path: directoryPath, paths: [`${directoryPath}/**`] };
}

/** Creates a temporary tree that the test disposes of, returning its root. */
function makeTree(entries: Record<string, string>): string {
  return disposeOnTestFinished(createTempTree(entries, { prefix: 'release-kit-directory-' })).dir;
}

// endregion | Helpers
