import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
}));

import { resolveReleaseTags } from '../resolveReleaseTags.ts';
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
  beforeEach(() => {
    void silenceConsole(['warn']);
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns an empty array when HEAD is not tagged', () => {
    mockExecFileSync.mockReturnValue('');

    expect(resolveReleaseTags()).toStrictEqual([]);
  });

  it('resolves a single-package tag', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\n');

    expect(resolveReleaseTags()).toStrictEqual([
      { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
    ]);
  });

  it('ignores unrecognized tags in single-package mode', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\nsome-other-tag\nrelease-candidate\n');

    expect(resolveReleaseTags()).toStrictEqual([
      { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
    ]);
  });

  it('resolves monorepo tags whose tagPrefix matches a workspace', () => {
    mockExecFileSync.mockReturnValue('nmr-core-v1.3.0\nrelease-kit-v2.1.0\n');
    const workspaces = [
      makeWorkspace({ dir: 'core', tagPrefix: 'nmr-core-v', workspacePath: 'packages/core' }),
      makeWorkspace({ dir: 'release-kit', tagPrefix: 'release-kit-v', workspacePath: 'packages/release-kit' }),
    ];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([
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
    mockExecFileSync.mockReturnValue('nmr-core-v0.2.8\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'nmr-core-v', workspacePath: 'packages/core' })];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([
      { tag: 'nmr-core-v0.2.8', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('ignores monorepo tags with unrecognized prefixes', () => {
    mockExecFileSync.mockReturnValue('unknown-v1.0.0\ncore-v1.3.0\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('ignores non-release tags in monorepo mode', () => {
    mockExecFileSync.mockReturnValue('core-v1.3.0\nsome-random-tag\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([
      { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('resolves pre-release monorepo tags like core-v1.0.0-beta.1', () => {
    mockExecFileSync.mockReturnValue('core-v1.0.0-beta.1\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([
      { tag: 'core-v1.0.0-beta.1', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
    ]);
  });

  it('handles tags with multiple hyphens in the package name', () => {
    mockExecFileSync.mockReturnValue('my-cool-lib-v3.0.0\n');
    const workspaces = [
      makeWorkspace({ dir: 'my-cool-lib', tagPrefix: 'my-cool-lib-v', workspacePath: 'packages/my-cool-lib' }),
    ];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([
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
    mockExecFileSync.mockReturnValue('foo-bar-v1.0.0\nfoo-v2.0.0\n');
    const workspaces = [
      makeWorkspace({ dir: 'foo', tagPrefix: 'foo-v' }),
      makeWorkspace({ dir: 'foo-bar', tagPrefix: 'foo-bar-v' }),
    ];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([
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
    mockExecFileSync.mockReturnValue('unrelated-tag\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags({ workspaces })).toStrictEqual([]);
  });

  it('warns and returns only the first tag when multiple single-package version tags exist', () => {
    mockExecFileSync.mockReturnValue('v1.0.0\nv1.1.0\n');

    const result = resolveReleaseTags();

    expect(result).toStrictEqual([
      { tag: 'v1.0.0', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple version tags found on HEAD: v1.0.0, v1.1.0'),
    );
  });

  it('does not warn when only one single-package version tag exists', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\n');

    resolveReleaseTags();

    expect(console.warn).not.toHaveBeenCalled();
  });

  describe('project tags', () => {
    const project = { tagPrefix: 'v' };

    it('resolves the project tag at the repo root alongside workspace tags', () => {
      mockExecFileSync.mockReturnValue('core-v1.3.0\nv0.13.0\n');
      const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

      expect(resolveReleaseTags({ workspaces, project })).toStrictEqual([
        { tag: 'core-v1.3.0', kind: 'package', dir: 'core', workspacePath: 'packages/core', isPublishable: true },
        { tag: 'v0.13.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('resolves the project tag when no workspace is passed', () => {
      mockExecFileSync.mockReturnValue('v0.13.0\n');

      expect(resolveReleaseTags({ workspaces: [], project })).toStrictEqual([
        { tag: 'v0.13.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('matches a custom project prefix', () => {
      mockExecFileSync.mockReturnValue('app-v2.0.0\n');

      expect(resolveReleaseTags({ workspaces: [], project: { tagPrefix: 'app-v' } })).toStrictEqual([
        { tag: 'app-v2.0.0', kind: 'project', dir: '', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('identifies a tag by its target name: a renamed workspace and a named composite', () => {
      mockExecFileSync.mockReturnValue('nmr-core-v1.3.0\nsuite-v2.0.0\n');
      const workspaces = [{ ...makeWorkspace({ dir: 'nmr-core', tagPrefix: 'nmr-core-v' }), targetName: 'core' }];

      expect(
        resolveReleaseTags({ workspaces, project: { tagPrefix: 'suite-v', name: 'suite' } }).map(({ tag, dir }) => [
          tag,
          dir,
        ]),
      ).toStrictEqual([
        ['nmr-core-v1.3.0', 'core'],
        ['suite-v2.0.0', 'suite'],
      ]);
    });

    it('ignores a project-shaped tag when the project is not passed', () => {
      mockExecFileSync.mockReturnValue('v0.13.0\n');

      expect(resolveReleaseTags({ workspaces: [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })] })).toStrictEqual(
        [],
      );
    });
  });

  describe('directory tags', () => {
    const directories = [
      { name: 'app', path: 'apps/devopticon', versionFile: 'apps/devopticon/version.json', tagPrefix: 'devopticon-v' },
    ];

    it('resolves a directory tag at its directory as never publishable, beside workspace and project tags', () => {
      mockExecFileSync.mockReturnValue('core-v1.3.0\ndevopticon-v2.0.0\nv0.13.0\n');
      const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

      expect(resolveReleaseTags({ workspaces, directories, project: { tagPrefix: 'v' } })).toStrictEqual([
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
      mockExecFileSync.mockReturnValue('v1.0.0\n');
      const root = [{ name: 'repo', path: '.', versionFile: 'package.json', tagPrefix: 'v' }];

      expect(resolveReleaseTags({ workspaces: [], directories: root })).toStrictEqual([
        { tag: 'v1.0.0', kind: 'directory', dir: 'repo', workspacePath: '.', isPublishable: false },
      ]);
    });
  });

  describe('isPublishable propagation', () => {
    it('copies isPublishable=false from the matched workspace onto the resolved tag', () => {
      mockExecFileSync.mockReturnValue('basic-v1.0.0\n');
      const workspaces = [
        makeWorkspace({ dir: 'basic', tagPrefix: 'basic-v', workspacePath: 'packages/basic', isPublishable: false }),
      ];

      expect(resolveReleaseTags({ workspaces })).toStrictEqual([
        { tag: 'basic-v1.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);
    });

    it('mixes isPublishable values across matched workspaces in a single resolution', () => {
      mockExecFileSync.mockReturnValue('public-v1.0.0\nbasic-v2.0.0\n');
      const workspaces = [
        makeWorkspace({ dir: 'public', tagPrefix: 'public-v', workspacePath: 'packages/public', isPublishable: true }),
        makeWorkspace({ dir: 'basic', tagPrefix: 'basic-v', workspacePath: 'packages/basic', isPublishable: false }),
      ];

      expect(resolveReleaseTags({ workspaces })).toStrictEqual([
        { tag: 'public-v1.0.0', kind: 'package', dir: 'public', workspacePath: 'packages/public', isPublishable: true },
        { tag: 'basic-v2.0.0', kind: 'package', dir: 'basic', workspacePath: 'packages/basic', isPublishable: false },
      ]);
    });

    it('uses singleWorkspace.isPublishable for single-package tags', () => {
      mockExecFileSync.mockReturnValue('v1.2.3\n');
      const single = makeWorkspace({
        dir: 'root',
        tagPrefix: 'v',
        workspacePath: '.',
        isPublishable: false,
      });

      expect(resolveReleaseTags({ singleWorkspace: single })).toStrictEqual([
        { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: false },
      ]);
    });

    it('defaults single-package isPublishable to true when singleWorkspace is omitted', () => {
      mockExecFileSync.mockReturnValue('v1.2.3\n');

      expect(resolveReleaseTags()).toStrictEqual([
        { tag: 'v1.2.3', kind: 'package', dir: '.', workspacePath: '.', isPublishable: true },
      ]);
    });
  });
});
