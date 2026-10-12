import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
import type { WorkspaceDiscovery } from '../discoverWorkspaces.ts';
import { isSinglePackageTargets, resolveReleaseTargets } from '../resolveReleaseTargets.ts';
import type { ReleaseKitConfig, ReleaseTarget } from '../types.ts';

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
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  describe('single-package repo', () => {
    it('projects one package target at the root that reads the whole history', () => {
      files.set('package.json', { name: 'solo', version: '1.0.0' });

      const { targets } = resolveReleaseTargets(undefined, SINGLE);

      expect(targets).toStrictEqual([
        {
          id: '.',
          kind: 'package',
          tagPrefix: 'v',
          versionFiles: ['package.json'],
          changelogDir: '.',
          packagePath: '.',
          isPublishable: true,
        },
      ]);
    });

    it('records a private root package as not publishable', () => {
      files.set('package.json', { name: 'solo', private: true });

      const [target] = resolveReleaseTargets(undefined, SINGLE).targets;

      expect(target?.isPublishable).toBe(false);
    });

    it('keeps the shared settings beside the target', () => {
      files.set('package.json', { name: 'solo' });

      const { settings } = resolveReleaseTargets({ formatCommand: 'pnpm fmt', scopeAliases: { c: 'core' } }, SINGLE);

      expect(settings).toMatchObject({
        changelogJson: DEFAULT_CHANGELOG_JSON_CONFIG,
        formatCommand: 'pnpm fmt',
        releaseNotes: DEFAULT_RELEASE_NOTES_CONFIG,
        scopeAliases: { c: 'core' },
      });
    });

    it('rejects a project block with the single-package error', () => {
      expect(() => resolveReleaseTargets({ project: {} }, SINGLE)).toThrow(
        'project block is not supported in single-package mode',
      );
    });
  });

  describe('monorepo', () => {
    beforeEach(() => {
      files.set('package.json', { name: 'root', version: '0.5.0', private: true });
      files.set('packages/core/package.json', { name: '@scope/core' });
      files.set('packages/cli/package.json', { name: 'cli', private: true });
    });

    it('projects one package target per workspace, in discovery order', () => {
      const { targets } = resolveReleaseTargets(undefined, packages('packages/core', 'packages/cli'));

      expect(targets).toStrictEqual([
        {
          id: 'core',
          kind: 'package',
          packageName: '@scope/core',
          tagPrefix: 'core-v',
          versionFiles: ['packages/core/package.json'],
          changelogDir: 'packages/core',
          paths: ['packages/core/**'],
          isPublishable: true,
          packagePath: 'packages/core',
          workspaceDir: 'core',
        },
        {
          id: 'cli',
          kind: 'package',
          packageName: 'cli',
          tagPrefix: 'cli-v',
          versionFiles: ['packages/cli/package.json'],
          changelogDir: 'packages/cli',
          paths: ['packages/cli/**'],
          isPublishable: false,
          packagePath: 'packages/cli',
          workspaceDir: 'cli',
        },
      ]);
    });

    it('projects a workspace at the repo root with the paths that deriveWorkspaceConfig gives it', () => {
      files.set('package.json', { name: '@scope/root', version: '0.5.0' });

      const { targets } = resolveReleaseTargets(undefined, packages('.', 'packages/core'));

      expect(targets[0]).toMatchObject({
        id: '.',
        kind: 'package',
        tagPrefix: 'root-v',
        versionFiles: ['./package.json'],
        changelogDir: '.',
        packagePath: '.',
        workspaceDir: '.',
      });
    });

    it('drops an excluded workspace', () => {
      const { targets } = resolveReleaseTargets(
        { workspaces: [{ dir: 'cli', shouldExclude: true }] },
        packages('packages/core', 'packages/cli'),
      );

      expect(targets.map((target) => target.id)).toStrictEqual(['core']);
    });

    it('attaches declared legacy identities to their workspace', () => {
      const legacyIdentities = [{ name: '@scope/old-core', tagPrefix: 'old-core-v' }];

      const { targets } = resolveReleaseTargets(
        { workspaces: [{ dir: 'core', legacyIdentities }] },
        packages('packages/core', 'packages/cli'),
      );

      expect(targets[0]?.legacyIdentities).toStrictEqual(legacyIdentities);
      expect(targets[1]).not.toHaveProperty('legacyIdentities');
    });

    it('appends a composite for an empty project block, rolling up the retained workspaces', () => {
      const { targets } = resolveReleaseTargets(
        { project: {}, workspaces: [{ dir: 'cli', shouldExclude: true }] },
        packages('packages/core', 'packages/cli'),
      );

      expect(targets.at(-1)).toStrictEqual({
        id: '',
        kind: 'composite',
        members: ['core'],
        tagPrefix: 'v',
        versionFiles: ['./package.json'],
        changelogDir: '.',
        paths: ['packages/core/**'],
        isPublishable: false,
      });
    });

    it('takes the composite commit window from project.paths', () => {
      const { targets } = resolveReleaseTargets({ project: { paths: ['src/**'] } }, packages('packages/core'));

      expect(targets.at(-1)?.paths).toStrictEqual(['src/**']);
    });

    it('takes the composite tag prefix from project.tagPrefix', () => {
      const { targets } = resolveReleaseTargets({ project: { tagPrefix: 'release-v' } }, packages('packages/core'));

      expect(targets.at(-1)?.tagPrefix).toBe('release-v');
    });

    it('keeps the root package.json validation of a project block', () => {
      files.set('package.json', { name: 'root' });

      expect(() => resolveReleaseTargets({ project: {} }, packages('packages/core'))).toThrow(
        "project block requires root package.json to have a 'version' field",
      );
    });

    it('keeps the collision checks of the merged config', () => {
      files.set('packages/other/package.json', { name: '@other/core' });

      expect(() => resolveReleaseTargets(undefined, packages('packages/core', 'packages/other'))).toThrow(
        "Duplicate tag prefix 'core-v'",
      );
    });
  });

  describe('derived tag prefixes', () => {
    beforeEach(() => {
      files.set('package.json', { name: 'root-pkg', version: '1.0.0' });
      files.set('packages/scoped/package.json', { name: '@acme/scoped-lib' });
      files.set('packages/plain/package.json', { name: 'plain-lib' });
    });

    it.each<{ shape: string; config: ReleaseKitConfig | undefined; discovery: Discovery; expected: string[] }>([
      { shape: 'single package', config: undefined, discovery: SINGLE, expected: ['v'] },
      {
        shape: 'scoped and unscoped workspaces',
        config: undefined,
        discovery: packages('packages/scoped', 'packages/plain'),
        expected: ['scoped-lib-v', 'plain-lib-v'],
      },
      {
        shape: 'a workspace at the repo root',
        config: undefined,
        discovery: packages('.', 'packages/plain'),
        expected: ['root-pkg-v', 'plain-lib-v'],
      },
      {
        shape: 'an empty project block',
        config: { project: {} },
        discovery: packages('packages/plain'),
        expected: ['plain-lib-v', 'v'],
      },
      {
        shape: 'a project block with paths',
        config: { project: { paths: ['**'] } },
        discovery: packages('packages/plain'),
        expected: ['plain-lib-v', 'v'],
      },
      {
        shape: 'a project tag prefix',
        config: { project: { tagPrefix: 'project-v' } },
        discovery: packages('packages/plain'),
        expected: ['plain-lib-v', 'project-v'],
      },
      {
        shape: 'an exclusion',
        config: { workspaces: [{ dir: 'scoped', shouldExclude: true }] },
        discovery: packages('packages/scoped', 'packages/plain'),
        expected: ['plain-lib-v'],
      },
      {
        shape: 'a legacy identity',
        config: { workspaces: [{ dir: 'plain', legacyIdentities: [{ name: 'old', tagPrefix: 'old-v' }] }] },
        discovery: packages('packages/plain'),
        expected: ['plain-lib-v'],
      },
    ])('derives $expected for $shape', ({ config, discovery, expected }) => {
      const { targets } = resolveReleaseTargets(config, discovery);

      expect(targets.map((target) => target.tagPrefix)).toStrictEqual(expected);
    });
  });
});

describe(isSinglePackageTargets, () => {
  it('accepts the root package target alone', () => {
    expect(isSinglePackageTargets([packageTarget({ id: '.' })])).toBe(true);
  });

  it('rejects a lone workspace target, even at the repo root', () => {
    expect(isSinglePackageTargets([packageTarget({ id: '.', workspaceDir: '.' })])).toBe(false);
  });

  it('rejects an empty list', () => {
    expect(isSinglePackageTargets([])).toBe(false);
  });
});

// region | Helpers

type Discovery = Exclude<WorkspaceDiscovery, { kind: 'empty' }>;

const SINGLE: Discovery = { kind: 'single-package' };

/** Builds a monorepo discovery of the given workspace paths. */
function packages(...packageDirs: string[]): Discovery {
  return { kind: 'packages', packageDirs, patterns: ['packages/*'] };
}

/** Builds a minimal package target, overriding the given fields. */
function packageTarget(overrides: Partial<Extract<ReleaseTarget, { kind: 'package' }>>): ReleaseTarget {
  return {
    id: 'pkg',
    kind: 'package',
    tagPrefix: 'v',
    versionFiles: ['package.json'],
    changelogDir: '.',
    packagePath: '.',
    isPublishable: true,
    ...overrides,
  };
}

/** Maps an absolute path under the working directory to the repo-relative key of `files`. */
function toRelative(filePath: string): string {
  return path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath) : path.normalize(filePath);
}

// endregion | Helpers
