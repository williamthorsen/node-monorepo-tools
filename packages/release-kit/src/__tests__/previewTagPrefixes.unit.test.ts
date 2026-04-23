import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockDiscoverWorkspaces = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockDeriveWorkspaceConfig = vi.hoisted(() => vi.fn());
const mockDetectUndeclared = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('../discoverWorkspaces.ts', () => ({
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock('../loadConfig.ts', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../deriveWorkspaceConfig.ts', () => ({
  deriveWorkspaceConfig: mockDeriveWorkspaceConfig,
}));

vi.mock('../detectUndeclaredTagPrefixes.ts', () => ({
  detectUndeclaredTagPrefixes: mockDetectUndeclared,
}));

import { previewTagPrefixes } from '../previewTagPrefixes.ts';

/** Build a mock implementation for git invocations returning tag counts by prefix. */
function setupTagCounts(byPrefix: Record<string, string[]>): void {
  mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd !== 'git' || args[0] !== 'tag' || args[1] !== '--list') return '';
    const matchArg = args[2] ?? '';
    const prefix = matchArg.endsWith('*') ? matchArg.slice(0, -1) : matchArg;
    const tags = byPrefix[prefix] ?? [];
    return tags.join('\n') + (tags.length > 0 ? '\n' : '');
  });
}

describe(previewTagPrefixes, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockDiscoverWorkspaces.mockReset();
    mockLoadConfig.mockReset();
    mockDeriveWorkspaceConfig.mockReset();
    mockDetectUndeclared.mockReset();
  });

  it('returns one row per discovered workspace with derived prefix and tag counts', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core', 'packages/arrays']);
    mockLoadConfig.mockResolvedValue(undefined);
    mockDeriveWorkspaceConfig.mockImplementation((path: string) => {
      if (path === 'packages/core') return { tagPrefix: 'nmr-core-v' };
      if (path === 'packages/arrays') return { tagPrefix: 'arrays-v' };
      throw new Error(`unexpected path: ${path}`);
    });
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({
      'nmr-core-v': ['nmr-core-v1.0.0', 'nmr-core-v1.1.0'],
      'arrays-v': ['arrays-v0.1.0'],
    });

    const result = await previewTagPrefixes();

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

  it('records derivationError and continues when deriveWorkspaceConfig() throws for a workspace', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/good', 'packages/broken']);
    mockLoadConfig.mockResolvedValue(undefined);
    mockDeriveWorkspaceConfig.mockImplementation((path: string) => {
      if (path === 'packages/good') return { tagPrefix: 'good-v' };
      throw new Error(`packages/broken/package.json is missing a 'name' field`);
    });
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({});

    const result = await previewTagPrefixes();

    expect(result.workspaces[0]?.derivedPrefix).toBe('good-v');
    expect(result.workspaces[0]?.derivationError).toBeNull();
    expect(result.workspaces[1]?.derivedPrefix).toBeNull();
    expect(result.workspaces[1]?.derivationError).toContain("missing a 'name' field");
    expect(result.workspaces[1]?.derivedTagCount).toBe(0);
  });

  it('surfaces declared legacy prefixes with their tag counts', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockLoadConfig.mockResolvedValue({
      workspaces: [
        {
          dir: 'core',
          legacyIdentities: [
            { name: '@old-scope/core', tagPrefix: 'core-v' },
            { name: '@older-scope/core', tagPrefix: 'old-core-v' },
          ],
        },
      ],
    });
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'nmr-core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({
      'nmr-core-v': [],
      'core-v': ['core-v0.2.7', 'core-v0.2.8'],
      'old-core-v': [],
    });

    const result = await previewTagPrefixes();

    expect(result.workspaces[0]?.legacyEntries).toStrictEqual([
      { prefix: 'core-v', tagCount: 2 },
      { prefix: 'old-core-v', tagCount: 0 },
    ]);
  });

  it('detects cross-workspace tag-prefix collisions', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/a-foo', 'packages/b-foo']);
    mockLoadConfig.mockResolvedValue(undefined);
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'foo-v' });
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({});

    const result = await previewTagPrefixes();

    expect(result.collisions).toStrictEqual([
      { tagPrefix: 'foo-v', workspacePaths: ['packages/a-foo', 'packages/b-foo'] },
    ]);
  });

  it('passes the union of derived and declared prefixes to detectUndeclaredTagPrefixes', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockLoadConfig.mockResolvedValue({
      workspaces: [{ dir: 'core', legacyIdentities: [{ name: '@old-scope/core', tagPrefix: 'core-v' }] }],
    });
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'nmr-core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({});

    await previewTagPrefixes();

    expect(mockDetectUndeclared).toHaveBeenCalledWith(expect.arrayContaining(['nmr-core-v', 'core-v']));
  });

  it('returns detection results as undeclaredCandidates in the preview', async () => {
    mockDiscoverWorkspaces.mockResolvedValue([]);
    mockLoadConfig.mockResolvedValue(undefined);
    mockDetectUndeclared.mockReturnValue([
      { prefix: 'orphan-v', tagCount: 1, exampleTags: ['orphan-v1.0.0'], suggestedDir: 'orphan' },
    ]);
    setupTagCounts({});

    const result = await previewTagPrefixes();

    expect(result.undeclaredCandidates).toStrictEqual([
      { prefix: 'orphan-v', tagCount: 1, exampleTags: ['orphan-v1.0.0'], suggestedDir: 'orphan' },
    ]);
  });

  it('returns declared retired packages with their tag counts and preserves successor when present', async () => {
    mockDiscoverWorkspaces.mockResolvedValue([]);
    mockLoadConfig.mockResolvedValue({
      retiredPackages: [
        { name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup' },
        { name: '@scope/dead', tagPrefix: 'dead-v' },
      ],
    });
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({
      'preflight-v': ['preflight-v1.0.0', 'preflight-v1.1.0', 'preflight-v2.0.0'],
      'dead-v': [],
    });

    const result = await previewTagPrefixes();

    expect(result.retiredPackages).toStrictEqual([
      { name: '@scope/preflight', tagPrefix: 'preflight-v', successor: 'readyup', tagCount: 3 },
      { name: '@scope/dead', tagPrefix: 'dead-v', tagCount: 0 },
    ]);
  });

  it('passes retired tagPrefixes to detectUndeclaredTagPrefixes as known', async () => {
    mockDiscoverWorkspaces.mockResolvedValue(['packages/core']);
    mockLoadConfig.mockResolvedValue({
      retiredPackages: [{ name: '@scope/preflight', tagPrefix: 'preflight-v' }],
    });
    mockDeriveWorkspaceConfig.mockReturnValue({ tagPrefix: 'nmr-core-v' });
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({});

    await previewTagPrefixes();

    expect(mockDetectUndeclared).toHaveBeenCalledWith(expect.arrayContaining(['nmr-core-v', 'preflight-v']));
  });

  it('returns an empty retiredPackages array when the config omits the field', async () => {
    mockDiscoverWorkspaces.mockResolvedValue([]);
    mockLoadConfig.mockResolvedValue({});
    mockDetectUndeclared.mockReturnValue([]);
    setupTagCounts({});

    const result = await previewTagPrefixes();

    expect(result.retiredPackages).toStrictEqual([]);
  });
});
