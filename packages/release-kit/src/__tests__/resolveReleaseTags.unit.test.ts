import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveReleaseTags } from '../resolveReleaseTags.ts';
import { type FakeGit, makeFakeGit } from '../test-utils/fakeGit.ts';
import type { WorkspaceConfig } from '../types.ts';

/** Builds a publishable workspace config under `packages/{dir}`, overriding any field. */
function makeWorkspace(
  overrides: Partial<WorkspaceConfig> & Pick<WorkspaceConfig, 'dir' | 'tagPrefix'>,
): WorkspaceConfig {
  const dir = overrides.dir;
  const workspacePath = overrides.workspacePath ?? `packages/${dir}`;
  return {
    dir,
    name: overrides.name ?? `@test/${dir}`,
    tagPrefix: overrides.tagPrefix,
    workspacePath,
    isPublishable: overrides.isPublishable ?? true,
    packageFiles: overrides.packageFiles ?? [`${workspacePath}/package.json`],
    paths: overrides.paths ?? [`${workspacePath}/**`],
  };
}

describe(resolveReleaseTags, () => {
  let git: FakeGit;

  beforeEach(() => {
    git = makeFakeGit();
    void silenceConsole(['warn']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array when HEAD is not tagged', () => {
    git.listTagsAtHead.mockReturnValue([]);

    expect(resolveReleaseTags(undefined, git)).toStrictEqual([]);
  });

  it('resolves a single-package tag', () => {
    git.listTagsAtHead.mockReturnValue(['v1.2.3']);

    expect(resolveReleaseTags(undefined, git)).toStrictEqual([
      { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
    ]);
  });

  it('ignores unrecognized tags in single-package mode', () => {
    git.listTagsAtHead.mockReturnValue(['v1.2.3', 'some-other-tag', 'release-candidate']);

    expect(resolveReleaseTags(undefined, git)).toStrictEqual([
      { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
    ]);
  });

  it('resolves monorepo tags whose tagPrefix matches a workspace', () => {
    git.listTagsAtHead.mockReturnValue(['nmr-core-v1.3.0', 'release-kit-v2.1.0']);
    const workspaces = [
      makeWorkspace({ dir: 'core', tagPrefix: 'nmr-core-v', workspacePath: 'packages/core' }),
      makeWorkspace({ dir: 'release-kit', tagPrefix: 'release-kit-v', workspacePath: 'packages/release-kit' }),
    ];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
      { tag: 'nmr-core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
      {
        tag: 'release-kit-v2.1.0',
        kind: 'package',
        dir: 'release-kit',
        workspacePath: 'packages/release-kit',
        isPublishable: true,
      },
    ]);
  });

  it('reports dir from workspace.dir, not the tagPrefix, when directory differs from package name', () => {
    git.listTagsAtHead.mockReturnValue(['nmr-core-v0.2.8']);
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'nmr-core-v', workspacePath: 'packages/core' })];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
      { tag: 'nmr-core-v0.2.8', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('ignores monorepo tags with unrecognized prefixes', () => {
    git.listTagsAtHead.mockReturnValue(['unknown-v1.0.0', 'core-v1.3.0']);
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('ignores non-release tags in monorepo mode', () => {
    git.listTagsAtHead.mockReturnValue(['core-v1.3.0', 'some-random-tag']);
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('resolves pre-release monorepo tags like core-v1.0.0-beta.1', () => {
    git.listTagsAtHead.mockReturnValue(['core-v1.0.0-beta.1']);
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
      { tag: 'core-v1.0.0-beta.1', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('handles tags with multiple hyphens in the package name', () => {
    git.listTagsAtHead.mockReturnValue(['my-cool-lib-v3.0.0']);
    const workspaces = [
      makeWorkspace({ dir: 'my-cool-lib', tagPrefix: 'my-cool-lib-v', workspacePath: 'packages/my-cool-lib' }),
    ];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
      {
        tag: 'my-cool-lib-v3.0.0',
        kind: 'package',
        dir: 'my-cool-lib',
        workspacePath: 'packages/my-cool-lib',
        isPublishable: true,
      },
    ]);
  });

  it('prefers the longest matching prefix when two prefixes nest', () => {
    git.listTagsAtHead.mockReturnValue(['foo-bar-v1.0.0', 'foo-v2.0.0']);
    const workspaces = [
      makeWorkspace({ dir: 'foo', tagPrefix: 'foo-v' }),
      makeWorkspace({ dir: 'foo-bar', tagPrefix: 'foo-bar-v' }),
    ];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
      {
        tag: 'foo-bar-v1.0.0',
        kind: 'package',
        dir: 'foo-bar',
        workspacePath: 'packages/foo-bar',
        isPublishable: true,
      },
      { tag: 'foo-v2.0.0', kind: 'package', dir: 'foo', workspacePath: 'packages/foo', isPublishable: true },
    ]);
  });

  it('returns an empty array when the tags do not match any workspace in monorepo mode', () => {
    git.listTagsAtHead.mockReturnValue(['unrelated-tag']);
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([]);
  });

  it('warns and returns only the first tag when multiple single-package version tags exist', () => {
    git.listTagsAtHead.mockReturnValue(['v1.0.0', 'v1.1.0']);

    const result = resolveReleaseTags(undefined, git);

    expect(result).toStrictEqual([
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple version tags found on HEAD: v1.0.0, v1.1.0'),
    );
  });

  it('does not warn when only one single-package version tag exists', () => {
    git.listTagsAtHead.mockReturnValue(['v1.2.3']);

    resolveReleaseTags(undefined, git);

    expect(console.warn).not.toHaveBeenCalled();
  });

  describe('project tags', () => {
    const project = { tagPrefix: 'v' };

    it('resolves the project tag at the repo root alongside workspace tags', () => {
      git.listTagsAtHead.mockReturnValue(['core-v1.3.0', 'v0.13.0']);
      const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

      expect(resolveReleaseTags({ workspaces, project }, git)).toStrictEqual([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        { tag: 'v0.13.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('resolves the project tag when no workspace is passed', () => {
      git.listTagsAtHead.mockReturnValue(['v0.13.0']);

      expect(resolveReleaseTags({ workspaces: [], project }, git)).toStrictEqual([
        { tag: 'v0.13.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('matches a custom project prefix', () => {
      git.listTagsAtHead.mockReturnValue(['app-v2.0.0']);

      expect(resolveReleaseTags({ workspaces: [], project: { tagPrefix: 'app-v' } }, git)).toStrictEqual([
        { tag: 'app-v2.0.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('identifies a tag by its target name: a renamed workspace and a named composite', () => {
      git.listTagsAtHead.mockReturnValue(['nmr-core-v1.3.0', 'suite-v2.0.0']);
      const workspaces = [{ ...makeWorkspace({ dir: 'nmr-core', tagPrefix: 'nmr-core-v' }), targetName: 'core' }];

      expect(
        resolveReleaseTags({ workspaces, project: { tagPrefix: 'suite-v', name: 'suite' } }, git).map(
          ({ tag, dir }) => [tag, dir],
        ),
      ).toStrictEqual([
        ['nmr-core-v1.3.0', 'core'],
        ['suite-v2.0.0', 'suite'],
      ]);
    });

    it('ignores a project-shaped tag when the project is not passed', () => {
      git.listTagsAtHead.mockReturnValue(['v0.13.0']);

      expect(
        resolveReleaseTags({ workspaces: [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })] }, git),
      ).toStrictEqual([]);
    });
  });

  describe('directory tags', () => {
    const directories = [
      { name: 'app', path: 'apps/devopticon', versionFile: 'apps/devopticon/version.json', tagPrefix: 'devopticon-v' },
    ];

    it('resolves a directory tag at its directory as never publishable, beside workspace and project tags', () => {
      git.listTagsAtHead.mockReturnValue(['core-v1.3.0', 'devopticon-v2.0.0', 'v0.13.0']);
      const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

      expect(resolveReleaseTags({ workspaces, directories, project: { tagPrefix: 'v' } }, git)).toStrictEqual([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        {
          tag: 'devopticon-v2.0.0',
          kind: 'directory',
          dir: 'app',
          workspacePath: 'apps/devopticon',
          isPublishable: false,
        },
        { tag: 'v0.13.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('resolves the repo-root directory tag under its v prefix', () => {
      git.listTagsAtHead.mockReturnValue(['v1.0.0']);
      const rootDirectories = [{ name: 'repo', path: '.', versionFile: 'package.json', tagPrefix: 'v' }];

      expect(resolveReleaseTags({ workspaces: [], directories: rootDirectories }, git)).toStrictEqual([
        { tag: 'v1.0.0', kind: 'directory', dir: 'repo', workspacePath: '.', isPublishable: false },
      ]);
    });
  });

  describe('isPublishable propagation', () => {
    it('copies isPublishable=false from the matched workspace onto the resolved tag', () => {
      git.listTagsAtHead.mockReturnValue(['basic-v1.0.0']);
      const workspaces = [
        makeWorkspace({ dir: 'basic', tagPrefix: 'basic-v', workspacePath: 'packages/basic', isPublishable: false }),
      ];

      expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);
    });

    it('mixes isPublishable values across matched workspaces in a single resolution', () => {
      git.listTagsAtHead.mockReturnValue(['public-v1.0.0', 'basic-v2.0.0']);
      const workspaces = [
        makeWorkspace({ dir: 'public', tagPrefix: 'public-v', workspacePath: 'packages/public', isPublishable: true }),
        makeWorkspace({ dir: 'basic', tagPrefix: 'basic-v', workspacePath: 'packages/basic', isPublishable: false }),
      ];

      expect(resolveReleaseTags({ workspaces }, git)).toStrictEqual([
        { tag: 'public-v1.0.0', kind: 'package', dir: 'public', workspacePath: 'packages/public', isPublishable: true },
        { tag: 'basic-v2.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);
    });

    it('uses singleWorkspace.isPublishable for single-package tags', () => {
      git.listTagsAtHead.mockReturnValue(['v1.2.3']);
      const singleWorkspace = makeWorkspace({
        dir: 'root',
        tagPrefix: 'v',
        workspacePath: '.',
        isPublishable: false,
      });

      expect(resolveReleaseTags({ singleWorkspace }, git)).toStrictEqual([
        { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('defaults single-package isPublishable to true when singleWorkspace is omitted', () => {
      git.listTagsAtHead.mockReturnValue(['v1.2.3']);

      expect(resolveReleaseTags(undefined, git)).toStrictEqual([
        { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
      ]);
    });
  });
});
