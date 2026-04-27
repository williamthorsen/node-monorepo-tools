import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockJitiImport = vi.hoisted(() => vi.fn());

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('jiti', () => ({
  createJiti: () => ({ import: mockJitiImport }),
}));

import { DEFAULT_VERSION_PATTERNS, DEFAULT_WORK_TYPES } from '../defaults.ts';
import {
  CONFIG_FILE_PATH,
  loadConfig,
  mergeMonorepoConfig,
  mergeSinglePackageConfig,
  readRootPackageVersion,
} from '../loadConfig.ts';

/**
 * Configure `mockReadFileSync` to return a `package.json` with the given `name` per workspace
 * path. Any path not in the map triggers a test failure rather than a silent default.
 */
function mockPackageNames(namesByPath: Record<string, string>): void {
  mockReadFileSync.mockImplementation((filePath: string) => {
    for (const [workspacePath, name] of Object.entries(namesByPath)) {
      if (filePath === `${workspacePath}/package.json`) {
        return JSON.stringify({ name });
      }
    }
    throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
  });
}

describe(loadConfig, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockJitiImport.mockReset();
  });

  it('returns undefined when the config file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await loadConfig();

    expect(result).toBeUndefined();
  });

  it('resolves the config path against process.cwd()', async () => {
    const expectedPath = path.resolve(process.cwd(), CONFIG_FILE_PATH);
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: {} });

    await loadConfig();

    expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    expect(mockJitiImport).toHaveBeenCalledWith(expectedPath);
  });

  it('throws when jiti returns a non-object value', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue('not-an-object');

    await expect(loadConfig()).rejects.toThrow('Config file must export an object, got string');
  });

  it('throws when jiti returns an array', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue([1, 2, 3]);

    await expect(loadConfig()).rejects.toThrow('Config file must export an object, got array');
  });

  it('throws when the exported record has no default or config export', async () => {
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ unrelated: true });

    await expect(loadConfig()).rejects.toThrow('must have a default export or a named `config` export');
  });

  it('returns the default export when present', async () => {
    const configObject = { workTypes: { perf: { header: 'Performance' } } };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: configObject });

    const result = await loadConfig();

    expect(result).toBe(configObject);
  });

  it('returns the named config export when no default is present', async () => {
    const configObject = { formatCommand: 'pnpm run fmt' };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ config: configObject });

    const result = await loadConfig();

    expect(result).toBe(configObject);
  });

  it('prefers the default export over the named config export', async () => {
    const defaultConfig = { formatCommand: 'default' };
    const namedConfig = { formatCommand: 'named' };
    mockExistsSync.mockReturnValue(true);
    mockJitiImport.mockResolvedValue({ default: defaultConfig, config: namedConfig });

    const result = await loadConfig();

    expect(result).toBe(defaultConfig);
  });
});

describe(mergeMonorepoConfig, () => {
  const discoveredPaths = ['packages/arrays', 'packages/strings'];

  beforeEach(() => {
    mockPackageNames({
      'packages/arrays': '@scope/arrays',
      'packages/strings': '@scope/strings',
    });
  });

  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('builds default workspaces from discovered paths using pkg.name for tagPrefix', () => {
    const result = mergeMonorepoConfig(discoveredPaths, undefined);

    expect(result.workspaces).toHaveLength(2);
    expect(result.workspaces[0]).toStrictEqual({
      dir: 'arrays',
      name: '@scope/arrays',
      tagPrefix: 'arrays-v',
      workspacePath: 'packages/arrays',
      packageFiles: ['packages/arrays/package.json'],
      changelogPaths: ['packages/arrays'],
      paths: ['packages/arrays/**'],
    });
  });

  it('derives tagPrefix from unscoped pkg.name when directory basename differs', () => {
    mockPackageNames({
      'libs/core': '@williamthorsen/nmr-core',
      'apps/web': 'web-app',
    });

    const result = mergeMonorepoConfig(['libs/core', 'apps/web'], undefined);

    expect(result.workspaces).toHaveLength(2);
    expect(result.workspaces[0]).toStrictEqual({
      dir: 'core',
      name: '@williamthorsen/nmr-core',
      tagPrefix: 'nmr-core-v',
      workspacePath: 'libs/core',
      packageFiles: ['libs/core/package.json'],
      changelogPaths: ['libs/core'],
      paths: ['libs/core/**'],
    });
    expect(result.workspaces[1]?.tagPrefix).toBe('web-app-v');
  });

  it('uses default workTypes when no config is provided', () => {
    const result = mergeMonorepoConfig(discoveredPaths, undefined);
    expect(result.workTypes).toStrictEqual(DEFAULT_WORK_TYPES);
  });

  it('uses default versionPatterns when no config is provided', () => {
    const result = mergeMonorepoConfig(discoveredPaths, undefined);
    expect(result.versionPatterns).toStrictEqual(DEFAULT_VERSION_PATTERNS);
  });

  it('excludes workspaces with shouldExclude', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      workspaces: [{ dir: 'strings', shouldExclude: true }],
    });

    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]?.tagPrefix).toBe('arrays-v');
  });

  it('merges custom workTypes with defaults', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      workTypes: { perf: { header: 'Performance' } },
    });

    expect(result.workTypes?.perf).toStrictEqual({ header: 'Performance' });
    expect(result.workTypes?.fix).toStrictEqual(DEFAULT_WORK_TYPES.fix);
  });

  it('replaces versionPatterns entirely when provided', () => {
    const customPatterns = { major: ['!', 'breaking'], minor: ['feat', 'perf'] };
    const result = mergeMonorepoConfig(discoveredPaths, {
      versionPatterns: customPatterns,
    });

    expect(result.versionPatterns).toStrictEqual(customPatterns);
  });

  it('passes through formatCommand from config', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      formatCommand: 'pnpm run fmt',
    });

    expect(result.formatCommand).toBe('pnpm run fmt');
  });

  it('passes through cliffConfigPath from config', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      cliffConfigPath: 'custom/cliff.toml',
    });

    expect(result.cliffConfigPath).toBe('custom/cliff.toml');
  });

  it('passes through scopeAliases from config', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      scopeAliases: { api: 'backend-api' },
    });

    expect(result.scopeAliases).toStrictEqual({ api: 'backend-api' });
  });

  it('throws when two workspaces produce the same tagPrefix', () => {
    mockPackageNames({
      'packages/a-foo': '@a/foo',
      'packages/b-foo': '@b/foo',
    });

    expect(() => mergeMonorepoConfig(['packages/a-foo', 'packages/b-foo'], undefined)).toThrow(
      "Duplicate tag prefix 'foo-v' for workspaces: packages/a-foo, packages/b-foo",
    );
  });

  it('throws on duplicate tagPrefix even when one colliding workspace is excluded', () => {
    mockPackageNames({
      'packages/a-foo': '@a/foo',
      'packages/b-foo': '@b/foo',
    });

    expect(() =>
      mergeMonorepoConfig(['packages/a-foo', 'packages/b-foo'], {
        workspaces: [{ dir: 'b-foo', shouldExclude: true }],
      }),
    ).toThrow("Duplicate tag prefix 'foo-v' for workspaces: packages/a-foo, packages/b-foo");
  });

  it('propagates legacyIdentities from a matching workspace override', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      workspaces: [
        {
          dir: 'arrays',
          legacyIdentities: [
            { name: '@old-scope/arrays', tagPrefix: 'old-arrays-v' },
            { name: '@legacy-scope/arrays', tagPrefix: 'legacy-v' },
          ],
        },
      ],
    });

    expect(result.workspaces[0]?.dir).toBe('arrays');
    expect(result.workspaces[0]?.legacyIdentities).toStrictEqual([
      { name: '@old-scope/arrays', tagPrefix: 'old-arrays-v' },
      { name: '@legacy-scope/arrays', tagPrefix: 'legacy-v' },
    ]);
    expect(result.workspaces[1]?.legacyIdentities).toBeUndefined();
  });

  it('shallow-clones each identity entry so mutating the override does not leak into merged workspaces', () => {
    const identity = { name: '@old-scope/arrays', tagPrefix: 'old-arrays-v' };
    const result = mergeMonorepoConfig(discoveredPaths, {
      workspaces: [{ dir: 'arrays', legacyIdentities: [identity] }],
    });

    identity.tagPrefix = 'mutated-v';

    expect(result.workspaces[0]?.legacyIdentities).toStrictEqual([
      { name: '@old-scope/arrays', tagPrefix: 'old-arrays-v' },
    ]);
  });

  it('leaves legacyIdentities undefined when the override omits the field', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      workspaces: [{ dir: 'arrays', shouldExclude: false }],
    });

    expect(result.workspaces[0]?.legacyIdentities).toBeUndefined();
  });

  it('throws when a legacyIdentities entry matches both the current name and tagPrefix', () => {
    expect(() =>
      mergeMonorepoConfig(discoveredPaths, {
        workspaces: [
          {
            dir: 'arrays',
            legacyIdentities: [{ name: '@scope/arrays', tagPrefix: 'arrays-v' }],
          },
        ],
      }),
    ).toThrow(
      "Workspace 'arrays': legacyIdentities must not match the current identity (name='@scope/arrays', tagPrefix='arrays-v')",
    );
  });

  it('accepts an identity whose tagPrefix matches the current but whose name differs', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      workspaces: [
        {
          dir: 'arrays',
          legacyIdentities: [{ name: '@old-scope/arrays', tagPrefix: 'arrays-v' }],
        },
      ],
    });

    expect(result.workspaces[0]?.legacyIdentities).toStrictEqual([
      { name: '@old-scope/arrays', tagPrefix: 'arrays-v' },
    ]);
  });

  it('accepts an identity whose name matches the current but whose tagPrefix differs', () => {
    const result = mergeMonorepoConfig(discoveredPaths, {
      workspaces: [
        {
          dir: 'arrays',
          legacyIdentities: [{ name: '@scope/arrays', tagPrefix: 'old-arrays-v' }],
        },
      ],
    });

    expect(result.workspaces[0]?.legacyIdentities).toStrictEqual([
      { name: '@scope/arrays', tagPrefix: 'old-arrays-v' },
    ]);
  });

  it('throws when a retiredPackages entry tagPrefix matches an active workspace derived prefix', () => {
    expect(() =>
      mergeMonorepoConfig(discoveredPaths, {
        retiredPackages: [{ name: '@old-scope/arrays', tagPrefix: 'arrays-v' }],
      }),
    ).toThrow(
      "retiredPackages: tagPrefix 'arrays-v' collides with active workspace 'arrays' (derived prefix 'arrays-v'). A retired package's tagPrefix cannot belong to an active workspace.",
    );
  });

  it('accepts retiredPackages whose tagPrefix does not match any active workspace', () => {
    expect(() =>
      mergeMonorepoConfig(discoveredPaths, {
        retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup' }],
      }),
    ).not.toThrow();
  });

  it('accepts an empty retiredPackages array', () => {
    // The guard in `mergeMonorepoConfig` calls `assertRetiredPackagesDoNotCollideWithActive`
    // for any non-undefined value; exercising the empty-iterable path ensures the call does
    // not throw when the user declares `retiredPackages: []` explicitly.
    expect(() =>
      mergeMonorepoConfig(discoveredPaths, {
        retiredPackages: [],
      }),
    ).not.toThrow();
  });

  it('includes every colliding workspace path when more than two collide', () => {
    mockPackageNames({
      'packages/a-foo': '@a/foo',
      'packages/b-foo': '@b/foo',
      'packages/c-foo': '@c/foo',
    });

    expect(() => mergeMonorepoConfig(['packages/a-foo', 'packages/b-foo', 'packages/c-foo'], undefined)).toThrow(
      "Duplicate tag prefix 'foo-v' for workspaces: packages/a-foo, packages/b-foo, packages/c-foo",
    );
  });
});

describe(readRootPackageVersion, () => {
  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  it('returns exists=false when the root package.json is missing', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readRootPackageVersion()).toStrictEqual({ exists: false, version: undefined });
  });

  it('returns the version when the root package.json declares one', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '1.2.3' }));
    expect(readRootPackageVersion()).toStrictEqual({ exists: true, version: '1.2.3' });
  });

  it('returns version=undefined when the root package.json has no version field', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root' }));
    expect(readRootPackageVersion()).toStrictEqual({ exists: true, version: undefined });
  });

  it('throws a clear error when the root package.json contains invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{ not valid json');
    expect(() => readRootPackageVersion()).toThrow(/Failed to parse root package\.json/);
  });
});

describe('mergeMonorepoConfig project block', () => {
  const discoveredPaths = ['packages/arrays', 'packages/strings'];

  beforeEach(() => {
    mockPackageNames({
      'packages/arrays': '@scope/arrays',
      'packages/strings': '@scope/strings',
    });
  });

  afterEach(() => {
    mockReadFileSync.mockReset();
  });

  it('omits project from the merged config when the consumer did not declare one', () => {
    const result = mergeMonorepoConfig(discoveredPaths, undefined);
    expect(result.project).toBeUndefined();
  });

  it('resolves an empty project block to the default tagPrefix', () => {
    const result = mergeMonorepoConfig(discoveredPaths, { project: {} }, { exists: true, version: '0.9.0' });
    expect(result.project).toStrictEqual({ tagPrefix: 'v' });
  });

  it('preserves a custom project tagPrefix', () => {
    const result = mergeMonorepoConfig(
      discoveredPaths,
      { project: { tagPrefix: 'release-v' } },
      { exists: true, version: '0.9.0' },
    );
    expect(result.project).toStrictEqual({ tagPrefix: 'release-v' });
  });

  it('throws when project is configured but the root package.json is missing', () => {
    expect(() => mergeMonorepoConfig(discoveredPaths, { project: {} }, { exists: false, version: undefined })).toThrow(
      /project block requires a root package\.json/,
    );
  });

  it('throws when project is configured but the root package.json has no version field', () => {
    expect(() => mergeMonorepoConfig(discoveredPaths, { project: {} }, { exists: true, version: undefined })).toThrow(
      /add a 'version' field to your root package\.json/,
    );
  });

  it('throws when no rootPackage info is supplied alongside a project block', () => {
    expect(() => mergeMonorepoConfig(discoveredPaths, { project: {} })).toThrow(
      /project block requires a root package\.json/,
    );
  });

  it('rejects a project tagPrefix colliding with a workspace derived prefix', () => {
    mockPackageNames({
      'packages/v-helpers': '@scope/v-helpers',
    });
    expect(() =>
      mergeMonorepoConfig(['packages/v-helpers'], { project: { tagPrefix: 'v' } }, { exists: true, version: '0.9.0' }),
    ).toThrow(/Tag prefix collision/);
  });

  it('rejects a project tagPrefix that strict-prefix-collides with a workspace prefix', () => {
    // `git describe --match=v*` would also match `vue-helpers-v1.0.0` tags.
    mockPackageNames({
      'packages/vue-helpers': '@scope/vue-helpers',
    });
    expect(() =>
      mergeMonorepoConfig(
        ['packages/vue-helpers'],
        { project: { tagPrefix: 'v' } },
        { exists: true, version: '0.9.0' },
      ),
    ).toThrow(/Tag prefix collision: 'vue-helpers-v' .* and 'v' \(project\)/);
  });

  it('rejects a project tagPrefix colliding with a declared legacy identity', () => {
    expect(() =>
      mergeMonorepoConfig(
        discoveredPaths,
        {
          workspaces: [{ dir: 'arrays', legacyIdentities: [{ name: '@old-scope/arrays', tagPrefix: 'release-v' }] }],
          project: { tagPrefix: 'release-v' },
        },
        { exists: true, version: '0.9.0' },
      ),
    ).toThrow(/Tag prefix collision: 'release-v'/);
  });

  it('rejects a project tagPrefix colliding with a retired-package prefix', () => {
    expect(() =>
      mergeMonorepoConfig(
        discoveredPaths,
        {
          retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v' }],
          project: { tagPrefix: 'preflight-v' },
        },
        { exists: true, version: '0.9.0' },
      ),
    ).toThrow(/Tag prefix collision: 'preflight-v'/);
  });

  it('accepts a workspace whose legacyIdentities reuses its own current tagPrefix (different name)', () => {
    // Existing intra-workspace rename pattern must keep working — a workspace's own current
    // prefix and its declared legacy identity prefix can match without colliding.
    expect(() =>
      mergeMonorepoConfig(discoveredPaths, {
        workspaces: [
          {
            dir: 'arrays',
            legacyIdentities: [{ name: '@old-scope/arrays', tagPrefix: 'arrays-v' }],
          },
        ],
      }),
    ).not.toThrow();
  });
});

describe(mergeSinglePackageConfig, () => {
  it('returns defaults when no config is provided', () => {
    const result = mergeSinglePackageConfig(undefined);

    expect(result.tagPrefix).toBe('v');
    expect(result.packageFiles).toStrictEqual(['package.json']);
    expect(result.changelogPaths).toStrictEqual(['.']);
    expect(result.workTypes).toStrictEqual(DEFAULT_WORK_TYPES);
    expect(result.versionPatterns).toStrictEqual(DEFAULT_VERSION_PATTERNS);
  });

  it('rejects a configured project block in single-package mode', () => {
    expect(() => mergeSinglePackageConfig({ project: {} })).toThrow(
      'project block is not supported in single-package mode',
    );
  });

  it('merges custom workTypes with defaults', () => {
    const result = mergeSinglePackageConfig({
      workTypes: { perf: { header: 'Performance' } },
    });

    expect(result.workTypes?.perf).toStrictEqual({ header: 'Performance' });
    expect(result.workTypes?.fix).toStrictEqual(DEFAULT_WORK_TYPES.fix);
  });

  it('replaces versionPatterns entirely when provided', () => {
    const customPatterns = { major: ['!'], minor: ['feat', 'perf'] };
    const result = mergeSinglePackageConfig({ versionPatterns: customPatterns });

    expect(result.versionPatterns).toStrictEqual(customPatterns);
  });

  it('passes through scalar overrides', () => {
    const result = mergeSinglePackageConfig({
      formatCommand: 'pnpm run fmt',
      cliffConfigPath: 'custom/cliff.toml',
      scopeAliases: { api: 'backend-api' },
    });

    expect(result.formatCommand).toBe('pnpm run fmt');
    expect(result.cliffConfigPath).toBe('custom/cliff.toml');
    expect(result.scopeAliases).toStrictEqual({ api: 'backend-api' });
  });
});
