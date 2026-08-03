import type { Workspace } from 'readyup/check-utils';
import { describe, expect, it } from 'vitest';

import { buildWorkspaceCheck, skipIfNotPublishable } from '../npm-auto-publish.ts';

function makeWorkspace(overrides: Partial<Workspace> & Pick<Workspace, 'isPackage'>): Workspace {
  return {
    dir: 'packages/example',
    absolutePath: '/repo/packages/example',
    name: '@scope/example',
    packageJson: { name: '@scope/example' },
    ...overrides,
  };
}

describe(skipIfNotPublishable, () => {
  it('returns false for a publishable workspace (isPackage true)', () => {
    const workspace = makeWorkspace({ isPackage: true });

    expect(skipIfNotPublishable(workspace)).toBe(false);
  });

  it('returns the skip reason for a non-publishable workspace (isPackage false)', () => {
    const workspace = makeWorkspace({ isPackage: false, packageJson: { name: '@scope/example', private: true } });

    expect(skipIfNotPublishable(workspace)).toBe('package.json#private is true');
  });
});

describe(buildWorkspaceCheck, () => {
  it('marks the parent check as skipped for a non-publishable workspace', async () => {
    const workspace = makeWorkspace({ isPackage: false, packageJson: { name: '@scope/example', private: true } });

    const check = buildWorkspaceCheck(workspace);

    expect(check.name).toBe('@scope/example');
    expect(check.skip).toBeDefined();
    await expect(Promise.resolve(check.skip?.())).resolves.toBe('package.json#private is true');
  });

  it('does not include a "not marked private" child check', () => {
    const workspace = makeWorkspace({ isPackage: true });

    const check = buildWorkspaceCheck(workspace);

    const childNames = check.checks?.map((c) => c.name) ?? [];
    expect(childNames).not.toContain('not marked private');
  });

  it('lets the parent check run when the workspace is publishable', async () => {
    const workspace = makeWorkspace({ isPackage: true });

    const check = buildWorkspaceCheck(workspace);

    await expect(Promise.resolve(check.skip?.())).resolves.toBe(false);
  });

  it('includes the scoped-name child only when the package name starts with @', () => {
    const scoped = buildWorkspaceCheck(makeWorkspace({ isPackage: true, name: '@scope/example' }));
    const unscoped = buildWorkspaceCheck(
      makeWorkspace({ isPackage: true, name: 'example', packageJson: { name: 'example' } }),
    );

    const scopedChildren = scoped.checks?.map((c) => c.name) ?? [];
    const unscopedChildren = unscoped.checks?.map((c) => c.name) ?? [];

    expect(scopedChildren).toContain('publishConfig.access is "public"');
    expect(unscopedChildren).not.toContain('publishConfig.access is "public"');
  });

  it('falls back to "(unnamed)" when the workspace has no name', () => {
    const workspace = makeWorkspace({ isPackage: true, name: undefined, packageJson: {} });

    const check = buildWorkspaceCheck(workspace);

    expect(check.name).toBe('(unnamed)');
  });
});
