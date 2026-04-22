import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
}));

import { buildDependencyGraph } from '../buildDependencyGraph.ts';
import type { WorkspaceConfig } from '../types.ts';

function makeWorkspace(dir: string, packageFile?: string): WorkspaceConfig {
  return {
    dir,
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    packageFiles: [packageFile ?? `packages/${dir}/package.json`],
    changelogPaths: [`packages/${dir}`],
    paths: [`packages/${dir}/**`],
  };
}

describe(buildDependencyGraph, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('builds a reverse dependency map for workspace dependencies', () => {
    const compA = makeWorkspace('core');
    const compB = makeWorkspace('release-kit');
    const compC = makeWorkspace('preflight');

    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('core')) {
        return JSON.stringify({ name: '@scope/core', version: '1.0.0' });
      }
      if (filePath.includes('release-kit')) {
        return JSON.stringify({
          name: '@scope/release-kit',
          version: '2.0.0',
          dependencies: { '@scope/core': 'workspace:*' },
        });
      }
      if (filePath.includes('preflight')) {
        return JSON.stringify({
          name: '@scope/preflight',
          version: '1.0.0',
          dependencies: { '@scope/core': 'workspace:*' },
        });
      }
      return '{}';
    });

    const graph = buildDependencyGraph([compA, compB, compC]);

    expect(graph.packageNameToDir.get('@scope/core')).toBe('core');
    expect(graph.packageNameToDir.get('@scope/release-kit')).toBe('release-kit');
    expect(graph.dirToPackageName.get('core')).toBe('@scope/core');
    expect(graph.dirToPackageName.get('release-kit')).toBe('@scope/release-kit');
    expect(graph.dependentsOf.get('@scope/core')).toStrictEqual([compB, compC]);
  });

  it('includes peerDependencies with workspace: protocol', () => {
    const compA = makeWorkspace('core');
    const compB = makeWorkspace('plugin');

    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('core')) {
        return JSON.stringify({ name: '@scope/core', version: '1.0.0' });
      }
      if (filePath.includes('plugin')) {
        return JSON.stringify({
          name: '@scope/plugin',
          version: '1.0.0',
          peerDependencies: { '@scope/core': 'workspace:^' },
        });
      }
      return '{}';
    });

    const graph = buildDependencyGraph([compA, compB]);

    expect(graph.dependentsOf.get('@scope/core')).toStrictEqual([compB]);
  });

  it('ignores non-workspace dependencies', () => {
    const compA = makeWorkspace('core');
    const compB = makeWorkspace('app');

    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('core')) {
        return JSON.stringify({ name: '@scope/core', version: '1.0.0' });
      }
      if (filePath.includes('app')) {
        return JSON.stringify({
          name: '@scope/app',
          version: '1.0.0',
          dependencies: { '@scope/core': '^1.0.0', lodash: '^4.0.0' },
        });
      }
      return '{}';
    });

    const graph = buildDependencyGraph([compA, compB]);

    expect(graph.dependentsOf.get('@scope/core')).toBeUndefined();
  });

  it('ignores devDependencies', () => {
    const compA = makeWorkspace('core');
    const compB = makeWorkspace('app');

    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('core')) {
        return JSON.stringify({ name: '@scope/core', version: '1.0.0' });
      }
      if (filePath.includes('app')) {
        return JSON.stringify({
          name: '@scope/app',
          version: '1.0.0',
          devDependencies: { '@scope/core': 'workspace:*' },
        });
      }
      return '{}';
    });

    const graph = buildDependencyGraph([compA, compB]);

    expect(graph.dependentsOf.get('@scope/core')).toBeUndefined();
  });

  it('handles transitive dependencies (A -> B -> C)', () => {
    const compA = makeWorkspace('core');
    const compB = makeWorkspace('middle');
    const compC = makeWorkspace('app');

    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('core')) {
        return JSON.stringify({ name: '@scope/core', version: '1.0.0' });
      }
      if (filePath.includes('middle')) {
        return JSON.stringify({
          name: '@scope/middle',
          version: '1.0.0',
          dependencies: { '@scope/core': 'workspace:*' },
        });
      }
      if (filePath.includes('app')) {
        return JSON.stringify({
          name: '@scope/app',
          version: '1.0.0',
          dependencies: { '@scope/middle': 'workspace:*' },
        });
      }
      return '{}';
    });

    const graph = buildDependencyGraph([compA, compB, compC]);

    expect(graph.dependentsOf.get('@scope/core')).toStrictEqual([compB]);
    expect(graph.dependentsOf.get('@scope/middle')).toStrictEqual([compC]);
  });

  it('returns empty maps when no workspaces have workspace dependencies', () => {
    const comp = makeWorkspace('standalone');

    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@scope/standalone', version: '1.0.0' }));

    const graph = buildDependencyGraph([comp]);

    expect(graph.packageNameToDir.size).toBe(1);
    expect(graph.dependentsOf.size).toBe(0);
  });

  it('handles workspaces with no packageFiles gracefully', () => {
    const comp: WorkspaceConfig = {
      dir: 'empty',
      name: '@test/empty',
      tagPrefix: 'empty-v',
      workspacePath: 'packages/empty',
      packageFiles: [],
      changelogPaths: [],
      paths: [],
    };

    const graph = buildDependencyGraph([comp]);

    expect(graph.packageNameToDir.size).toBe(0);
    expect(graph.dependentsOf.size).toBe(0);
  });
});
