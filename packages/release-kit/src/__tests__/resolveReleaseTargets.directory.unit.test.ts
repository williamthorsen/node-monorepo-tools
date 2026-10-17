import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockStatSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  statSync: mockStatSync,
}));

import type { ReleaseKitConfig } from '../configSchema.ts';
import type { WorkspaceDiscovery } from '../discoverWorkspaces.ts';
import { resolveReleaseTargets } from '../resolveReleaseTargets.ts';

/** Manifests keyed by repo-relative path; every test declares the files that the projection may read. */
const files = new Map<string, unknown>();

describe(resolveReleaseTargets, () => {
  beforeEach(() => {
    files.clear();
    mockExistsSync.mockImplementation((filePath: string) => files.has(toRelative(filePath)));
    mockReadFileSync.mockImplementation((filePath: string) => {
      const relative = toRelative(filePath);
      if (!files.has(relative)) {
        throw new Error(`ENOENT: ${relative}`);
      }
      return JSON.stringify(files.get(relative));
    });
    mockStatSync.mockImplementation((filePath: string) => {
      const relative = toRelative(filePath);
      const isDirectory = relative === '' || files.keys().some((key) => key.startsWith(`${relative}/`));
      return isDirectory ? { isDirectory: () => true } : undefined;
    });
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockStatSync.mockReset();
  });

  describe('directory targets', () => {
    beforeEach(() => {
      files.set('package.json', { name: 'root', version: '0.5.0', private: true });
      files.set('packages/cli/package.json', { name: 'cli' });
      files.set('apps/devopticon/version.json', { version: '1.2.0' });
    });

    const discovery = packages('packages/cli');

    it('projects a directory after the workspaces and before the composite', () => {
      const { targets } = resolveReleaseTargets(
        { releases: { app: { path: 'apps/devopticon' }, suite: { includes: ['cli', 'app'] } } },
        discovery,
      );

      expect(targets.map((target) => [target.kind, target.id])).toStrictEqual([
        ['package', 'cli'],
        ['directory', 'app'],
        ['composite', 'suite'],
      ]);
      expect(targets[1]).toStrictEqual({
        id: 'app',
        kind: 'directory',
        tagPrefix: 'devopticon-v',
        versionFiles: ['apps/devopticon/version.json'],
        changelogDir: 'apps/devopticon',
        paths: ['apps/devopticon/**'],
        isPublishable: false,
        directoryPath: 'apps/devopticon',
      });
      expect(targets[2]).toMatchObject({ members: ['cli', 'app'], paths: ['packages/cli/**', 'apps/devopticon/**'] });
    });

    it('projects the repo root as a whole-repo target versioned by the root package.json', () => {
      const { targets } = resolveReleaseTargets({ releases: { repo: { path: '.' } } }, discovery);

      expect(targets.at(-1)).toStrictEqual({
        id: 'repo',
        kind: 'directory',
        tagPrefix: 'v',
        versionFiles: ['package.json'],
        changelogDir: '.',
        isPublishable: false,
        directoryPath: '.',
      });
    });

    it("leaves every workspace's tag prefix unchanged", () => {
      const withDirectory = resolveReleaseTargets({ releases: { repo: { path: '.' } } }, discovery);
      const without = resolveReleaseTargets(undefined, discovery);

      expect(withDirectory.targets[0]).toStrictEqual(without.targets[0]);
    });

    it.each([
      [
        'the repo root beside a composite',
        { repo: { path: '.' }, suite: { includes: ['cli'] } },
        "directory release 'repo' and composite release 'suite' share the version file 'package.json'",
      ],
      [
        'a directory prefix that collides with a workspace prefix',
        { app: { path: 'apps/devopticon', tagPrefix: 'cli-v' } },
        "Tag prefix collision: 'cli-v' (workspace 'cli') and 'cli-v' (directory release 'app')",
      ],
      [
        'a directory named like a workspace',
        { cli: { path: 'apps/devopticon' } },
        "Duplicate release target id 'cli' for workspaces: packages/cli, apps/devopticon",
      ],
    ] satisfies Array<[string, NonNullable<ReleaseKitConfig['releases']>, string]>)(
      'rejects %s',
      (_description, releases, message) => {
        expect(() => resolveReleaseTargets({ releases }, discovery)).toThrow(message);
      },
    );
  });
});

// region | Helpers

/** Builds a monorepo discovery of the given workspace paths. */
function packages(...packageDirs: string[]): Exclude<WorkspaceDiscovery, { kind: 'empty' }> {
  return { kind: 'packages', packageDirs, patterns: ['packages/*'] };
}

/** Maps an absolute path under the working directory to the repo-relative key of `files`. */
function toRelative(filePath: string): string {
  return path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) : path.normalize(filePath);
}

// endregion | Helpers
