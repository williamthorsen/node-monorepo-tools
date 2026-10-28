import { describe, expect, it } from 'vitest';

import type { ReleaseKitConfig } from '../configSchema.ts';
import { resolveReleaseDeclaration } from '../resolveReleaseDeclaration.ts';
import type { WorkspaceConfig } from '../types.ts';

const WORKSPACES = [makeWorkspace('core'), makeWorkspace('cli')];

describe(resolveReleaseDeclaration, () => {
  it('declares a directory for a path that is not a discovered workspace, in config order', () => {
    const declaration = resolveReleaseDeclaration(
      WORKSPACES,
      wrapInConfig({
        site: { path: './docs/site/' },
        app: { path: 'apps/devopticon', tagPrefix: 'app-v' },
      }),
    );

    expect(declaration.retainedWorkspaces.map((workspace) => workspace.dir)).toStrictEqual(['core', 'cli']);
    expect(declaration.directories).toStrictEqual([
      { name: 'site', path: 'docs/site', paths: ['docs/site/**'] },
      { name: 'app', path: 'apps/devopticon', paths: ['apps/devopticon/**'], tagPrefix: 'app-v' },
    ]);
  });

  it('declares the repo root with a whole-repo window', () => {
    const declaration = resolveReleaseDeclaration(WORKSPACES, wrapInConfig({ repo: { path: './' } }));

    expect(declaration.directories).toStrictEqual([{ name: 'repo', path: '.' }]);
  });

  it('copies the legacy identities of a directory entry', () => {
    const legacyIdentities = [{ name: 'old-app', tagPrefix: 'old-app-v' }];

    const [directory] = resolveReleaseDeclaration(
      WORKSPACES,
      wrapInConfig({ app: { path: 'apps/app', legacyIdentities } }),
    ).directories;

    expect(directory?.legacyIdentities).toStrictEqual(legacyIdentities);
    expect(directory?.legacyIdentities).not.toBe(legacyIdentities);
  });

  it('lets a composite include a directory, whose window joins the union', () => {
    const { composite } = resolveReleaseDeclaration(
      WORKSPACES,
      wrapInConfig({ app: { path: 'apps/app' }, suite: { includes: ['core', 'app'] } }),
    );

    expect(composite).toStrictEqual({
      name: 'suite',
      members: ['core', 'app'],
      paths: ['packages/core/**', 'apps/app/**'],
    });
  });

  it('declares no directories for the legacy blocks', () => {
    expect(resolveReleaseDeclaration(WORKSPACES, { project: {} }).directories).toStrictEqual([]);
  });

  it.each([
    [
      'a path outside the repo',
      { app: { path: '../elsewhere' } },
      "releases.app: path '../elsewhere' is outside the repo; declare a repo-relative directory",
    ],
    [
      'an absolute path',
      { app: { path: '/opt/app' } },
      "releases.app: path '/opt/app' is outside the repo; declare a repo-relative directory",
    ],
    [
      'a tagPrefix on a workspace',
      { core: { path: 'packages/core', tagPrefix: 'c-v' } },
      "releases.core: tagPrefix applies only to a directory target, and 'packages/core' is a workspace",
    ],
    [
      'two entries for one directory',
      { a: { path: 'apps/app' }, b: { path: './apps/app' } },
      "releases.b: directory 'apps/app' is already declared by releases.a; declare each directory once",
    ],
    [
      'an unknown member, listing the directories among the known targets',
      { app: { path: 'apps/app' }, suite: { includes: ['web'] } },
      "releases.suite.includes: 'web' is not a release target. Known targets: core, cli, app",
    ],
  ] satisfies Array<[string, NonNullable<ReleaseKitConfig['releases']>, string]>)(
    'rejects %s',
    (_description, releases, message) => {
      expect(() => resolveReleaseDeclaration(WORKSPACES, wrapInConfig(releases))).toThrow(message);
    },
  );
});

// region | Helpers

/** Builds the discovered workspace of `@test/{dir}` under `packages/{dir}`. */
function makeWorkspace(dir: string): WorkspaceConfig {
  return {
    dir,
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    isPublishable: true,
    packageFiles: [`packages/${dir}/package.json`],
    paths: [`packages/${dir}/**`],
  };
}

/** Wraps a `releases` block in a config. */
function wrapInConfig(releases: NonNullable<ReleaseKitConfig['releases']>): ReleaseKitConfig {
  return { releases };
}

// endregion | Helpers
