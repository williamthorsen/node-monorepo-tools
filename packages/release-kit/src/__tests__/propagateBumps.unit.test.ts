import { describe, expect, it } from 'vitest';

import type { DependencyGraph } from '../buildDependencyGraph.ts';
import type { ReleaseEntry } from '../propagateBumps.ts';
import { propagateBumps } from '../propagateBumps.ts';
import type { WorkspaceConfig } from '../types.ts';

function makeWorkspace(dir: string): WorkspaceConfig {
  return {
    dir,
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    packageFiles: [`packages/${dir}/package.json`],
    changelogPaths: [`packages/${dir}`],
    paths: [`packages/${dir}/**`],
  };
}

function makeGraph(
  nameToDir: Record<string, string>,
  dependentsOf: Record<string, WorkspaceConfig[]>,
): DependencyGraph {
  const packageNameToDir = new Map(Object.entries(nameToDir));
  const dirToPackageName = new Map(Object.entries(nameToDir).map(([name, dir]) => [dir, name]));
  return {
    packageNameToDir,
    dirToPackageName,
    dependentsOf: new Map(Object.entries(dependentsOf)),
  };
}

describe(propagateBumps, () => {
  it('propagates a patch bump to a single dependent', () => {
    const dependent = makeWorkspace('release-kit');

    const graph = makeGraph(
      { '@scope/core': 'core', '@scope/release-kit': 'release-kit' },
      { '@scope/core': [dependent] },
    );

    const directBumps = new Map<string, ReleaseEntry>([['core', { releaseType: 'minor' }]]);

    const currentVersions = new Map([
      ['core', '1.0.0'],
      ['release-kit', '2.0.0'],
    ]);

    const result = propagateBumps(directBumps, graph, currentVersions);

    expect(result.get('core')).toMatchObject({ releaseType: 'minor' });
    expect(result.get('release-kit')).toMatchObject({
      releaseType: 'patch',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.1.0' }],
    });
  });

  it('propagates transitively (A -> B -> C)', () => {
    const compB = makeWorkspace('middle');
    const compC = makeWorkspace('app');

    const graph = makeGraph(
      { '@scope/core': 'core', '@scope/middle': 'middle', '@scope/app': 'app' },
      { '@scope/core': [compB], '@scope/middle': [compC] },
    );

    const directBumps = new Map<string, ReleaseEntry>([['core', { releaseType: 'patch' }]]);

    const currentVersions = new Map([
      ['core', '1.0.0'],
      ['middle', '2.0.0'],
      ['app', '3.0.0'],
    ]);

    const result = propagateBumps(directBumps, graph, currentVersions);

    expect(result.get('core')).toMatchObject({ releaseType: 'patch' });
    expect(result.get('middle')).toMatchObject({
      releaseType: 'patch',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.0.1' }],
    });
    expect(result.get('app')).toMatchObject({
      releaseType: 'patch',
      propagatedFrom: [{ packageName: '@scope/middle', newVersion: '2.0.1' }],
    });
  });

  it('does not downgrade a higher direct bump', () => {
    const dependent = makeWorkspace('release-kit');

    const graph = makeGraph(
      { '@scope/core': 'core', '@scope/release-kit': 'release-kit' },
      { '@scope/core': [dependent] },
    );

    const directBumps = new Map<string, ReleaseEntry>([
      ['core', { releaseType: 'patch' }],
      ['release-kit', { releaseType: 'minor' }],
    ]);

    const currentVersions = new Map([
      ['core', '1.0.0'],
      ['release-kit', '2.0.0'],
    ]);

    const result = propagateBumps(directBumps, graph, currentVersions);

    // release-kit keeps its minor bump but gains propagatedFrom metadata.
    expect(result.get('release-kit')).toMatchObject({
      releaseType: 'minor',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.0.1' }],
    });
  });

  it('handles circular dependencies without infinite loops', () => {
    const compA = makeWorkspace('alpha');
    const compB = makeWorkspace('beta');

    const graph = makeGraph(
      { '@scope/alpha': 'alpha', '@scope/beta': 'beta' },
      { '@scope/alpha': [compB], '@scope/beta': [compA] },
    );

    const directBumps = new Map<string, ReleaseEntry>([['alpha', { releaseType: 'patch' }]]);

    const currentVersions = new Map([
      ['alpha', '1.0.0'],
      ['beta', '2.0.0'],
    ]);

    // Should terminate without infinite loop.
    const result = propagateBumps(directBumps, graph, currentVersions);

    expect(result.get('alpha')).toMatchObject({ releaseType: 'patch' });
    expect(result.get('beta')).toMatchObject({
      releaseType: 'patch',
      propagatedFrom: [{ packageName: '@scope/alpha', newVersion: '1.0.1' }],
    });
  });

  it('adds propagatedFrom metadata to a directly bumped workspace with a propagated dependency', () => {
    const dependent = makeWorkspace('kit');

    const graph = makeGraph({ '@scope/core': 'core', '@scope/kit': 'kit' }, { '@scope/core': [dependent] });

    const directBumps = new Map<string, ReleaseEntry>([
      ['core', { releaseType: 'major' }],
      ['kit', { releaseType: 'patch' }],
    ]);

    const currentVersions = new Map([
      ['core', '1.0.0'],
      ['kit', '1.0.0'],
    ]);

    const result = propagateBumps(directBumps, graph, currentVersions);

    // kit is already in set with patch; propagation adds metadata but keeps bump type.
    expect(result.get('kit')).toMatchObject({
      releaseType: 'patch',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '2.0.0' }],
    });
  });

  it('handles multiple dependencies triggering propagation to the same workspace', () => {
    const compC = makeWorkspace('app');

    const graph = makeGraph(
      { '@scope/core': 'core', '@scope/utils': 'utils', '@scope/app': 'app' },
      { '@scope/core': [compC], '@scope/utils': [compC] },
    );

    const directBumps = new Map<string, ReleaseEntry>([
      ['core', { releaseType: 'patch' }],
      ['utils', { releaseType: 'minor' }],
    ]);

    const currentVersions = new Map([
      ['core', '1.0.0'],
      ['utils', '2.0.0'],
      ['app', '3.0.0'],
    ]);

    const result = propagateBumps(directBumps, graph, currentVersions);

    const appEntry = result.get('app');
    expect(appEntry).toBeDefined();
    expect(appEntry?.releaseType).toBe('patch');
    expect(appEntry?.propagatedFrom).toHaveLength(2);
    expect(appEntry?.propagatedFrom).toContainEqual({ packageName: '@scope/core', newVersion: '1.0.1' });
    expect(appEntry?.propagatedFrom).toContainEqual({ packageName: '@scope/utils', newVersion: '2.1.0' });
  });

  it('returns only direct bumps when there are no dependents', () => {
    const graph = makeGraph({ '@scope/core': 'core' }, {});

    const directBumps = new Map<string, ReleaseEntry>([['core', { releaseType: 'minor' }]]);
    const currentVersions = new Map([['core', '1.0.0']]);

    const result = propagateBumps(directBumps, graph, currentVersions);

    expect(result.size).toBe(1);
    expect(result.get('core')).toMatchObject({ releaseType: 'minor' });
  });

  it('uses newVersionOverride for propagation metadata instead of a bump-computed version', () => {
    const dependent = makeWorkspace('app');

    const graph = makeGraph({ '@scope/core': 'core', '@scope/app': 'app' }, { '@scope/core': [dependent] });

    // The sentinel releaseType ('patch') would compute 0.5.1 from 0.5.0, but the explicit
    // override must win so dependents see the set-version value.
    const directBumps = new Map<string, ReleaseEntry>([
      ['core', { releaseType: 'patch', newVersionOverride: '1.0.0' }],
    ]);

    const currentVersions = new Map([
      ['core', '0.5.0'],
      ['app', '2.0.0'],
    ]);

    const result = propagateBumps(directBumps, graph, currentVersions);

    expect(result.get('app')).toMatchObject({
      releaseType: 'patch',
      propagatedFrom: [{ packageName: '@scope/core', newVersion: '1.0.0' }],
    });
  });
});
