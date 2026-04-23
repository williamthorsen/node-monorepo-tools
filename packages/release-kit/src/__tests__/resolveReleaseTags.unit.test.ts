import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { resolveReleaseTags } from '../resolveReleaseTags.ts';
import type { WorkspaceConfig } from '../types.ts';

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
    packageFiles: overrides.packageFiles ?? [`${workspacePath}/package.json`],
    changelogPaths: overrides.changelogPaths ?? [workspacePath],
    paths: overrides.paths ?? [`${workspacePath}/**`],
  };
}

describe(resolveReleaseTags, () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    vi.restoreAllMocks();
  });

  it('returns an empty array when no tags point at HEAD', () => {
    mockExecFileSync.mockReturnValue('');

    expect(resolveReleaseTags()).toStrictEqual([]);
  });

  it('resolves a single-package tag', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\n');

    expect(resolveReleaseTags()).toStrictEqual([{ tag: 'v1.2.3', dir: '.', workspacePath: '.' }]);
  });

  it('ignores unrecognized tags in single-package mode', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\nsome-other-tag\nrelease-candidate\n');

    expect(resolveReleaseTags()).toStrictEqual([{ tag: 'v1.2.3', dir: '.', workspacePath: '.' }]);
  });

  it('resolves monorepo tags whose tagPrefix matches a workspace', () => {
    mockExecFileSync.mockReturnValue('nmr-core-v1.3.0\nrelease-kit-v2.1.0\n');
    const workspaces = [
      makeWorkspace({ dir: 'core', tagPrefix: 'nmr-core-v', workspacePath: 'packages/core' }),
      makeWorkspace({ dir: 'release-kit', tagPrefix: 'release-kit-v', workspacePath: 'packages/release-kit' }),
    ];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([
      { tag: 'nmr-core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);
  });

  it('reports dir from workspace.dir, not the tagPrefix, when directory differs from package name', () => {
    mockExecFileSync.mockReturnValue('nmr-core-v0.2.8\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'nmr-core-v', workspacePath: 'packages/core' })];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([
      { tag: 'nmr-core-v0.2.8', dir: 'core', workspacePath: 'packages/core' },
    ]);
  });

  it('ignores monorepo tags with unrecognized prefixes', () => {
    mockExecFileSync.mockReturnValue('unknown-v1.0.0\ncore-v1.3.0\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
    ]);
  });

  it('ignores non-release tags in monorepo mode', () => {
    mockExecFileSync.mockReturnValue('core-v1.3.0\nsome-random-tag\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
    ]);
  });

  it('resolves pre-release monorepo tags like core-v1.0.0-beta.1', () => {
    mockExecFileSync.mockReturnValue('core-v1.0.0-beta.1\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([
      { tag: 'core-v1.0.0-beta.1', dir: 'core', workspacePath: 'packages/core' },
    ]);
  });

  it('handles tags with multiple hyphens in the package name', () => {
    mockExecFileSync.mockReturnValue('my-cool-lib-v3.0.0\n');
    const workspaces = [
      makeWorkspace({ dir: 'my-cool-lib', tagPrefix: 'my-cool-lib-v', workspacePath: 'packages/my-cool-lib' }),
    ];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([
      { tag: 'my-cool-lib-v3.0.0', dir: 'my-cool-lib', workspacePath: 'packages/my-cool-lib' },
    ]);
  });

  it('prefers the longest matching prefix when two prefixes nest', () => {
    mockExecFileSync.mockReturnValue('foo-bar-v1.0.0\nfoo-v2.0.0\n');
    const workspaces = [
      makeWorkspace({ dir: 'foo', tagPrefix: 'foo-v' }),
      makeWorkspace({ dir: 'foo-bar', tagPrefix: 'foo-bar-v' }),
    ];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([
      { tag: 'foo-bar-v1.0.0', dir: 'foo-bar', workspacePath: 'packages/foo-bar' },
      { tag: 'foo-v2.0.0', dir: 'foo', workspacePath: 'packages/foo' },
    ]);
  });

  it('returns an empty array when no tags match in monorepo mode', () => {
    mockExecFileSync.mockReturnValue('unrelated-tag\n');
    const workspaces = [makeWorkspace({ dir: 'core', tagPrefix: 'core-v' })];

    expect(resolveReleaseTags(workspaces)).toStrictEqual([]);
  });

  it('warns and returns only the first tag when multiple single-package version tags exist', () => {
    mockExecFileSync.mockReturnValue('v1.0.0\nv1.1.0\n');

    const result = resolveReleaseTags();

    expect(result).toStrictEqual([{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Multiple version tags found on HEAD: v1.0.0, v1.1.0'),
    );
  });

  it('does not warn when only one single-package version tag exists', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\n');

    resolveReleaseTags();

    expect(console.warn).not.toHaveBeenCalled();
  });
});
