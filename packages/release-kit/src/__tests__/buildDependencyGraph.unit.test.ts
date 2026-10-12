import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  readFileSync: mockReadFileSync,
}));

import { buildDependencyGraph } from '../buildDependencyGraph.ts';
import { makeWorkspaceTarget } from '../test-utils/packageTargets.ts';

describe(buildDependencyGraph, () => {
  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('builds a reverse dependency map for workspace dependencies', () => {
    const compA = makeWorkspaceTarget('core');
    const compB = makeWorkspaceTarget('release-kit');
    const compC = makeWorkspaceTarget('preflight');

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
    const compA = makeWorkspaceTarget('core');
    const compB = makeWorkspaceTarget('plugin');

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
    const compA = makeWorkspaceTarget('core');
    const compB = makeWorkspaceTarget('app');

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
    const compA = makeWorkspaceTarget('core');
    const compB = makeWorkspaceTarget('app');

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
    const compA = makeWorkspaceTarget('core');
    const compB = makeWorkspaceTarget('middle');
    const compC = makeWorkspaceTarget('app');

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

  it("records each workspace's version by dir", () => {
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('core')) {
        return JSON.stringify({ name: '@scope/core', version: '1.0.0' });
      }
      return JSON.stringify({ name: '@scope/app', version: '2.3.4' });
    });

    const graph = buildDependencyGraph([makeWorkspaceTarget('core'), makeWorkspaceTarget('app')]);

    expect(graph.dirToVersion).toStrictEqual(
      new Map([
        ['core', '1.0.0'],
        ['app', '2.3.4'],
      ]),
    );
  });

  it('omits the version of a workspace whose package.json does not have a string version', () => {
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('private')) {
        return JSON.stringify({ name: '@scope/private', private: true });
      }
      return JSON.stringify({ name: '@scope/odd', version: 2 });
    });

    const graph = buildDependencyGraph([makeWorkspaceTarget('private'), makeWorkspaceTarget('odd')]);

    expect(graph.dirToVersion.size).toBe(0);
    expect(graph.packageNameToDir.size).toBe(2);
  });

  it('returns empty maps when the workspaces do not have workspace dependencies', () => {
    const comp = makeWorkspaceTarget('standalone');

    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@scope/standalone', version: '1.0.0' }));

    const graph = buildDependencyGraph([comp]);

    expect(graph.packageNameToDir.size).toBe(1);
    expect(graph.dependentsOf.size).toBe(0);
  });

  it('handles workspaces without packageFiles gracefully', () => {
    const comp = makeWorkspaceTarget('empty', { versionFiles: [] });

    const graph = buildDependencyGraph([comp]);

    expect(graph.packageNameToDir.size).toBe(0);
    expect(graph.dependentsOf.size).toBe(0);
  });

  it('names the unreadable package file and quotes the underlying message', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => buildDependencyGraph([makeWorkspaceTarget('core')])).toThrow(
      'Failed to read packages/core/package.json: EACCES: permission denied',
    );
  });

  it('preserves the underlying error as the cause when a package file cannot be read', () => {
    const underlying = new Error('EACCES: permission denied');
    mockReadFileSync.mockImplementation(() => {
      throw underlying;
    });

    expect(() => buildDependencyGraph([makeWorkspaceTarget('core')])).toThrow(
      expect.objectContaining({ cause: underlying }),
    );
  });

  it('names the package file containing invalid JSON', () => {
    mockReadFileSync.mockReturnValue('{ not valid json');

    expect(() => buildDependencyGraph([makeWorkspaceTarget('core')])).toThrow(
      /^Failed to parse JSON in packages\/core\/package\.json: /,
    );
  });

  it('preserves the underlying error as the cause when a package file contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('{ not valid json');

    expect(() => buildDependencyGraph([makeWorkspaceTarget('core')])).toThrow(
      expect.objectContaining({ cause: expect.any(SyntaxError) }),
    );
  });
});
