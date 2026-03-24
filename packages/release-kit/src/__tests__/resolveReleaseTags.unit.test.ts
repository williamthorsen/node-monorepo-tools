import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { resolveReleaseTags } from '../resolveReleaseTags.ts';

describe(resolveReleaseTags, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns an empty array when no tags point at HEAD', () => {
    mockExecFileSync.mockReturnValue('');

    expect(resolveReleaseTags()).toEqual([]);
  });

  it('resolves a single-package tag', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\n');

    expect(resolveReleaseTags()).toEqual([{ tag: 'v1.2.3', dir: '.', workspacePath: '.' }]);
  });

  it('ignores unrecognized tags in single-package mode', () => {
    mockExecFileSync.mockReturnValue('v1.2.3\nsome-other-tag\nrelease-candidate\n');

    expect(resolveReleaseTags()).toEqual([{ tag: 'v1.2.3', dir: '.', workspacePath: '.' }]);
  });

  it('resolves monorepo tags against the workspace map', () => {
    mockExecFileSync.mockReturnValue('core-v1.3.0\nrelease-kit-v2.1.0\n');
    const workspaceMap = new Map([
      ['core', 'packages/core'],
      ['release-kit', 'packages/release-kit'],
    ]);

    expect(resolveReleaseTags(workspaceMap)).toEqual([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
      { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
    ]);
  });

  it('ignores monorepo tags with unrecognized directory names', () => {
    mockExecFileSync.mockReturnValue('unknown-v1.0.0\ncore-v1.3.0\n');
    const workspaceMap = new Map([['core', 'packages/core']]);

    expect(resolveReleaseTags(workspaceMap)).toEqual([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
    ]);
  });

  it('ignores non-release tags in monorepo mode', () => {
    mockExecFileSync.mockReturnValue('core-v1.3.0\nsome-random-tag\n');
    const workspaceMap = new Map([['core', 'packages/core']]);

    expect(resolveReleaseTags(workspaceMap)).toEqual([
      { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
    ]);
  });

  it('handles tags with multiple hyphens in the directory name', () => {
    mockExecFileSync.mockReturnValue('my-cool-lib-v3.0.0\n');
    const workspaceMap = new Map([['my-cool-lib', 'packages/my-cool-lib']]);

    expect(resolveReleaseTags(workspaceMap)).toEqual([
      { tag: 'my-cool-lib-v3.0.0', dir: 'my-cool-lib', workspacePath: 'packages/my-cool-lib' },
    ]);
  });

  it('returns an empty array when no tags match in monorepo mode', () => {
    mockExecFileSync.mockReturnValue('unrelated-tag\n');
    const workspaceMap = new Map([['core', 'packages/core']]);

    expect(resolveReleaseTags(workspaceMap)).toEqual([]);
  });
});
