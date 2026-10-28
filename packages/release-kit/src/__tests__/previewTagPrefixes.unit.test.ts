import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());
const mockDetectUndeclared = vi.hoisted(() => vi.fn());
const mockDeriveDirectoryConfig = vi.hoisted(() => vi.fn());

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
}));

// Partial, so that `describeEmptyWorkspace` stays the real composer: What a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../deriveWorkspaceConfig.ts'), () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

vi.mock(import('../deriveDirectoryConfig.ts'), () => ({
  deriveDirectoryConfig: mockDeriveDirectoryConfig,
}));

vi.mock(import('../detectUndeclaredTagPrefixes.ts'), () => ({
  detectUndeclaredTagPrefixes: mockDetectUndeclared,
}));

import { previewTagPrefixes } from '../previewTagPrefixes.ts';
import { makeEmptyWorkspace, makeResolvedPackages, makeSinglePackage } from '../test-utils/workspaceResolutions.ts';

/** Builds a mock implementation for git invocations returning tag counts by prefix. */
function stubTagCounts(tagsByPrefix: Record<string, string[]>): void {
  mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd !== 'git' || args[0] !== 'tag' || args[1] !== '--list') return '';
    const matchArg = args[2] ?? '';
    const prefix = matchArg.endsWith('*') ? matchArg.slice(0, -1) : matchArg;
    const tags = tagsByPrefix[prefix] ?? [];
    return tags.join('\n') + (tags.length > 0 ? '\n' : '');
  });
}

describe(previewTagPrefixes, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockDiscoverWorkspaces.mockReset();
    mockDeriveWorkspaceConfig.mockReset();
    mockDetectUndeclared.mockReset();
    mockDeriveDirectoryConfig.mockReset();
  });

  it('returns one row per discovered workspace with derived prefix and tag counts', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core', 'packages/arrays']));
    mockDeriveWorkspaceConfig.mockImplementation((path: string) => {
      if (path === 'packages/core') return { tagPrefix: 'nmr-core-v' };
      if (path === 'packages/arrays') return { tagPrefix: 'arrays-v' };
      throw new Error(`unexpected path: ${path}`);
    });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({
      'nmr-core-v': ['nmr-core-v1.0.0', 'nmr-core-v1.1.0'],
      'arrays-v': ['arrays-v0.1.0'],
    });

    const result = previewTagPrefixes();

    expect(result.workspaces).toStrictEqual([
      {
        workspacePath: 'packages/core',
        dir: 'core',
        derivedPrefix: 'nmr-core-v',
        derivationError: null,
        derivedTagCount: 2,
        legacyEntries: [],
      },
      {
        workspacePath: 'packages/arrays',
        dir: 'arrays',
        derivedPrefix: 'arrays-v',
        derivationError: null,
        derivedTagCount: 1,
        legacyEntries: [],
      },
    ]);
    expect(result.collisions).toStrictEqual([]);
  });

  it('counts only tags whose suffix after the prefix is a complete SemVer version', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({
      'core-v': ['core-v1', 'core-v1.2', 'core-v1.2.0', 'core-v1.3.0-beta.1', 'core-vnext'],
    });

    const result = previewTagPrefixes();

    expect(result.workspaces[0]?.derivedTagCount).toBe(2);
  });

  it('records derivationError and continues when deriveWorkspaceConfig() throws for a workspace', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/good', 'packages/broken']));
    mockDeriveWorkspaceConfig.mockImplementation((path: string) => {
      if (path === 'packages/good') return { tagPrefix: 'good-v' };
      throw new Error(`packages/broken/package.json is missing a 'name' field`);
    });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({});

    const result = previewTagPrefixes();

    expect(result.workspaces[0]?.derivedPrefix).toBe('good-v');
    expect(result.workspaces[0]?.derivationError).toBeNull();
    expect(result.workspaces[1]?.derivedPrefix).toBeNull();
    expect(result.workspaces[1]?.derivationError).toContain("missing a 'name' field");
    expect(result.workspaces[1]?.derivedTagCount).toBe(0);
  });

  it('reports declared legacy prefixes with their tag counts', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    const config = {
      workspaces: [
        {
          dir: 'core',
          legacyIdentities: [
            { name: '@old-scope/core', tagPrefix: 'core-v' },
            { name: '@older-scope/core', tagPrefix: 'old-core-v' },
          ],
        },
      ],
    };
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'nmr-core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({
      'nmr-core-v': [],
      'core-v': ['core-v0.2.7', 'core-v0.2.8'],
      'old-core-v': [],
    });

    const result = previewTagPrefixes(config);

    expect(result.workspaces[0]?.legacyEntries).toStrictEqual([
      { prefix: 'core-v', tagCount: 2 },
      { prefix: 'old-core-v', tagCount: 0 },
    ]);
  });

  it('reports legacy prefixes declared on a releases entry, matched by path', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/nmr-core']));
    const config = {
      releases: {
        core: { path: './packages/nmr-core', legacyIdentities: [{ name: '@old/core', tagPrefix: 'core-v' }] },
      },
    };
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'nmr-core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({ 'nmr-core-v': [], 'core-v': ['core-v0.2.7'] });

    const result = previewTagPrefixes(config);

    expect(result.workspaces[0]?.legacyEntries).toStrictEqual([{ prefix: 'core-v', tagCount: 1 }]);
  });

  it('adds a row for each directory that a releases entry declares, recording a derivation failure on the row', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'core-v' });
    mockDeriveDirectoryConfig.mockImplementation((declaredDirectory: { path: string; tagPrefix?: string }) => {
      if (declaredDirectory.path === 'apps/app') return { tagPrefix: declaredDirectory.tagPrefix };
      throw new Error(`releases.docs: path '${declaredDirectory.path}' is not a directory`);
    });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({ 'app-v': ['app-v1.0.0'] });

    const result = previewTagPrefixes({
      releases: {
        core: { path: 'packages/core' },
        app: { path: './apps/app', tagPrefix: 'app-v' },
        docs: { path: 'docs' },
      },
    });

    expect(
      result.workspaces.map(({ workspacePath, derivedPrefix, derivedTagCount }) => [
        workspacePath,
        derivedPrefix,
        derivedTagCount,
      ]),
    ).toStrictEqual([
      ['packages/core', 'core-v', 0],
      ['apps/app', 'app-v', 1],
      ['docs', null, 0],
    ]);
    expect(result.workspaces[2]?.derivationError).toContain('is not a directory');
  });

  it('detects cross-workspace tag-prefix collisions', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/a-foo', 'packages/b-foo']));
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'foo-v' });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({});

    const result = previewTagPrefixes();

    expect(result.collisions).toStrictEqual([
      { tagPrefix: 'foo-v', workspacePaths: ['packages/a-foo', 'packages/b-foo'] },
    ]);
  });

  it('passes the union of derived and declared prefixes to detectUndeclaredTagPrefixes', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    const config = {
      workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@old-scope/core', tagPrefix: 'core-v' }] }],
    };
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'nmr-core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({});

    previewTagPrefixes(config);

    expect(mockDetectUndeclared).toHaveBeenCalledWith(expect.arrayContaining(['nmr-core-v', 'core-v']));
  });

  it.each([
    ['a releases composite', { releases: { suite: { includes: ['core'], tagPrefix: 'suite-v' } } }],
    ['a project block', { project: { tagPrefix: 'suite-v' } }],
  ])('passes the tag prefix of %s to detectUndeclaredTagPrefixes as known', (_label, config) => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({});

    previewTagPrefixes(config);

    expect(mockDetectUndeclared).toHaveBeenCalledWith(expect.arrayContaining(['core-v', 'suite-v']));
  });

  // An empty preview would show a clean table for a workspace whose manifest needs repairing.
  it("throws when the workspace doesn't resolve to any package", () => {
    mockDiscoverWorkspaces.mockReturnValue(makeEmptyWorkspace('all-excluded'));

    expect(() => previewTagPrefixes()).toThrow('No workspace package to preview.');
  });

  it('returns detection results as undeclaredCandidates in the preview', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockDetectUndeclared.mockReturnValue([
      { prefix: 'orphan-v', tagCount: 1, exampleTags: ['orphan-v1.0.0'], suggestedDir: 'orphan' },
    ]);
    stubTagCounts({});

    const result = previewTagPrefixes();

    expect(result.undeclaredCandidates).toStrictEqual([
      { prefix: 'orphan-v', tagCount: 1, exampleTags: ['orphan-v1.0.0'], suggestedDir: 'orphan' },
    ]);
  });

  it('returns declared retired packages with their tag counts and preserves successor when present', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    const config = {
      retiredPackages: [
        { name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup' },
        { name: '@scope/dead', tagPrefix: 'dead-v' },
      ],
    };
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({
      'preflight-v': ['preflight-v1.0.0', 'preflight-v1.1.0', 'preflight-v2.0.0'],
      'dead-v': [],
    });

    const result = previewTagPrefixes(config);

    expect(result.retiredPackages).toStrictEqual([
      { name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup', tagCount: 3 },
      { name: '@scope/dead', tagPrefix: 'dead-v', tagCount: 0 },
    ]);
  });

  it('passes retired tagPrefixes to detectUndeclaredTagPrefixes as known', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeResolvedPackages(['packages/core']));
    const config = {
      retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v' }],
    };
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'nmr-core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({});

    previewTagPrefixes(config);

    expect(mockDetectUndeclared).toHaveBeenCalledWith(expect.arrayContaining(['nmr-core-v', 'preflight-v']));
  });

  it('returns an empty retiredPackages array when the config omits the field', () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());
    mockDetectUndeclared.mockReturnValue([]);
    stubTagCounts({});

    const result = previewTagPrefixes({});

    expect(result.retiredPackages).toStrictEqual([]);
  });
});
