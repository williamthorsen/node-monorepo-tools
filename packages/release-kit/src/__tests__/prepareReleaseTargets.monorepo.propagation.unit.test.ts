import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPrepareReleaseTargetsMonorepoDefaults,
  listReadOptions,
  mockBuildEmptyReleaseEntry,
  mockBuildSyntheticChangelogEntry,
  mockExecFileSync,
  mockExecSync,
  mockExistsSync,
  mockHasPrettierConfig,
  mockMergeChangelogEntriesWithDisk,
  mockPlanReleaseNotesPreviews,
  mockReadFileSync,
  mockReadReleaseHistory,
  mockRenderChangelogJson,
  mockRenderChangelogMarkdown,
  mockWriteFileSync,
  resetPrepareReleaseTargetsMonorepoMocks,
  stubHistory,
  stubHistoryByPrefix,
} = await vi.hoisted(() => import('../test-utils/prepareReleaseTargetsMonorepoMocks.ts'));

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock(import('../hasPrettierConfig.ts'), () => ({
  hasPrettierConfig: mockHasPrettierConfig,
}));

vi.mock(import('../planReleaseNotesPreviews.ts'), () => ({
  planReleaseNotesPreviews: mockPlanReleaseNotesPreviews,
}));

// Stub the history reader and the changelog constructors and renderers. The default stubs return
// deterministic values without reading git history or touching the filesystem; `convertToChangelogEntries`
// stays real, so the planned changelog contains a history's sections, labeled with the new tag.
vi.mock(import('../buildChangelogEntries.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readReleaseHistory: mockReadReleaseHistory,
}));

vi.mock(import('../buildSyntheticChangelogEntry.ts'), () => ({
  buildSyntheticChangelogEntry: mockBuildSyntheticChangelogEntry,
}));

vi.mock(import('../buildEmptyReleaseEntry.ts'), () => ({
  buildEmptyReleaseEntry: mockBuildEmptyReleaseEntry,
}));

vi.mock(import('../changelogJsonFile.ts'), () => ({
  resolveChangelogJsonPath: (config: { changelogJson: { outputPath: string } }, changelogPath: string): string =>
    `${changelogPath}/${config.changelogJson.outputPath}`,
  renderChangelogJson: mockRenderChangelogJson,
  mergeChangelogEntriesWithDisk: mockMergeChangelogEntriesWithDisk,
}));

vi.mock(import('../renderChangelogMarkdown.ts'), () => ({
  renderChangelogFiles: (entries: unknown, options: unknown) => ({
    main: String(mockRenderChangelogMarkdown(entries, options)),
    archives: [],
  }),
}));

vi.mock(import('../changelogArchive.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  listArchiveFiles: () => [],
}));

import { selectPackageResults } from '../test-utils/prepareResults.ts';
import { makeReleaseHistory } from '../test-utils/releaseHistories.ts';
import {
  makeConfig,
  makeRoutedWorkspace,
  plannedContent,
  prepareMonorepo,
  stubPropagationWorkspaces,
  workTypes,
} from '../test-utils/prepareReleaseTargetsMonorepoFixtures.ts';
import type { ChangelogSection, MonorepoReleaseConfig, ReleaseType, UnroutedEntryScope } from '../types.ts';

describe('prepareReleaseTargets for a monorepo', () => {
  beforeEach(() => {
    applyPrepareReleaseTargetsMonorepoDefaults();
  });

  afterEach(() => {
    resetPrepareReleaseTargetsMonorepoMocks();
  });

  describe('dependency propagation', () => {
    it('propagates a patch bump to a dependent when a dependency is bumped', () => {
      const config = stubPropagationWorkspaces();

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });

      const result = prepareMonorepo(config, {});

      // core is bumped directly (minor), app is propagated (patch).
      expect(result.tags).toContain('core-v1.1.0');
      expect(result.tags).toContain('app-v2.0.1');
      expect(selectPackageResults(result)).toHaveLength(2);

      const coreResult = selectPackageResults(result).find((c) => c.name === 'core');
      expect(coreResult).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        newVersion: '1.1.0',
      });

      const appResult = selectPackageResults(result).find((c) => c.name === 'app');
      expect(appResult).toMatchObject({
        status: 'released',
        releaseType: 'patch',
        newVersion: '2.0.1',
        commitCount: 0,
        propagatedFrom: [{ packageName: '@test/core', newVersion: '1.1.0' }],
        propagatedOnly: true,
      });
      expect(coreResult).not.toHaveProperty('propagatedOnly');
    });

    it('writes a synthetic changelog for propagated-only workspaces', () => {
      const config = stubPropagationWorkspaces();

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['fix: bug fix', 'abc123']], bump: 'patch' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });

      const result = prepareMonorepo(config, {});

      // Each workspace's history is read once, in Phase 1; building the propagated app's changelog
      // reads nothing more.
      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['core-v'], paths: ['packages/core/**'], scope: 'core' },
        { tagPrefixes: ['app-v'], paths: ['packages/app/**'], scope: 'app' },
      ]);
      expect(result.writes.map((write) => write.path)).toContain('packages/core/CHANGELOG.md');

      // Synthetic propagation entry constructor was called for the app workspace, under the default deps header.
      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      const propagatedFromArg = mockBuildSyntheticChangelogEntry.mock.calls[0]?.[0];
      expect(JSON.stringify(propagatedFromArg)).toContain('@test/core');
      expect(mockBuildSyntheticChangelogEntry.mock.calls[0]?.[3]).toBe('📦 Dependencies');
      // The app's changelog is planned alongside core's.
      expect(result.writes.map((write) => write.path)).toContain('packages/app/CHANGELOG.md');
    });

    it('titles the synthetic changelog with the configured deps header', () => {
      const config = stubPropagationWorkspaces({ workTypes: { ...workTypes, deps: { header: '📦 Deps' } } });

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['fix: bug fix', 'abc123']], bump: 'patch' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });

      prepareMonorepo(config, {});

      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      expect(mockBuildSyntheticChangelogEntry.mock.calls[0]?.[3]).toBe('📦 Deps');
    });

    it('does not propagate to workspaces excluded from config.workspaces', () => {
      // Only `core` is in the config; `app`, which depends on it, is not.
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('core')] });

      stubHistory({ previousTag: 'core-v1.0.0', commits: [['feat: new feature', 'abc123']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '1.0.0' }));

      const result = prepareMonorepo(config, {});

      // Only core should be released since app is not in config.workspaces.
      expect(result.tags).toStrictEqual(['core-v1.1.0']);
      expect(selectPackageResults(result)).toHaveLength(1);
    });

    it('writes the explicit --set-version value in monorepo mode', () => {
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('core')] });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = prepareMonorepo(config, { versionOverridesById: new Map([['core', '1.0.0']]) });

      const coreResult = selectPackageResults(result).find((c) => c.name === 'core');
      expect(coreResult).toMatchObject({
        status: 'released',
        newVersion: '1.0.0',
        currentVersion: '0.5.0',
        versionOverride: '1.0.0',
      });
      assert(coreResult?.status === 'released', 'expected released');
      expect(coreResult.releaseType).toBeUndefined();
      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(plannedContent(result, 'packages/core/package.json')).toContain('"version": "1.0.0"');
    });

    it("builds a --set-version changelog from the workspace's one history read, leaving the decision's counts off", () => {
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('core')] });
      const sections: ChangelogSection[] = [
        { title: 'Bug fixes', audience: 'all', items: [{ description: 'Core fix', hash: 'abc123' }] },
      ];
      stubHistory({
        previousTag: 'core-v0.5.0',
        commits: [
          ['fix: core fix', 'abc123'],
          ['chore: tidy', 'def456'],
        ],
        bump: 'patch',
        parsedCommitCount: 1,
        unparseableCommits: [['chore: tidy', 'def456']],
        sections,
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = prepareMonorepo(config, { versionOverridesById: new Map([['core', '1.0.0']]) });

      expect(listReadOptions()).toStrictEqual([
        { tagPrefixes: ['core-v'], paths: ['packages/core/**'], scope: 'core' },
      ]);
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
        { version: '1.0.0', date: '2024-01-01', sections },
      ]);
      const coreResult = selectPackageResults(result)[0];
      assert(coreResult?.status === 'released', 'expected released');
      expect(coreResult).toMatchObject({ commitCount: 2, versionOverride: '1.0.0', previousTag: 'core-v0.5.0' });
      expect(coreResult.releaseType).toBeUndefined();
      expect(coreResult.parsedCommitCount).toBeUndefined();
      expect(coreResult.unparseableCommits).toBeUndefined();
    });

    it('throws when --set-version is not greater than the current version', () => {
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('core')] });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => prepareMonorepo(config, { versionOverridesById: new Map([['core', '0.3.0']]) })).toThrow(
        '--set-version 0.3.0 is not greater than current version 0.5.0',
      );
    });

    it('throws when --set-version equals the current version', () => {
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('core')] });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => prepareMonorepo(config, { versionOverridesById: new Map([['core', '0.5.0']]) })).toThrow(
        '--set-version 0.5.0 is not greater than current version 0.5.0',
      );
    });

    it('plans the --set-version tag without writing any file', () => {
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('core')] });

      stubHistory({ previousTag: 'core-v0.5.0' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = prepareMonorepo(config, { versionOverridesById: new Map([['core', '1.0.0']]) });

      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('records an explicit version as the propagated version of its dependents in a full run', () => {
      const config = stubPropagationWorkspaces();
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0' },
        'app-v': { previousTag: 'app-v2.0.0' },
      });

      const result = prepareMonorepo(config, { versionOverridesById: new Map([['core', '3.0.0']]) });

      expect(result.tags).toStrictEqual(['core-v3.0.0', 'app-v2.0.1']);
      expect(selectPackageResults(result).find((c) => c.name === 'app')).toMatchObject({
        status: 'released',
        propagatedFrom: [{ packageName: '@test/core', newVersion: '3.0.0' }],
        propagatedOnly: true,
      });
    });

    it('applies an explicit version alongside --force and --bump, which govern the other workspaces', () => {
      const config = stubPropagationWorkspaces(
        { workspaces: [makeRoutedWorkspace('core'), makeRoutedWorkspace('app'), makeRoutedWorkspace('util')] },
        { 'packages/util/package.json': JSON.stringify({ name: '@test/util', version: '0.1.0' }) },
      );
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0' },
        'app-v': { previousTag: 'app-v2.0.0' },
        'util-v': { previousTag: 'util-v0.1.0' },
      });

      const result = prepareMonorepo(config, {
        shouldForce: true,
        bumpOverride: 'minor',
        versionOverridesById: new Map([['core', '3.0.0']]),
      });

      expect(result.tags).toStrictEqual(['core-v3.0.0', 'util-v0.2.0', 'app-v2.1.0']);
    });
  });

  describe('--only', () => {
    /** Stubs `core`, `app` depending on it, `cli` depending on `app`, and the unrelated `util`. */
    function stubChainWorkspaces(): MonorepoReleaseConfig {
      return stubPropagationWorkspaces(
        {
          workspaces: ['core', 'app', 'cli', 'util'].map((dir) => makeRoutedWorkspace(dir)),
        },
        {
          'packages/cli/package.json': JSON.stringify({
            name: '@test/cli',
            version: '3.0.0',
            dependencies: { '@test/app': 'workspace:*' },
          }),
          'packages/util/package.json': JSON.stringify({ name: '@test/util', version: '0.1.0' }),
        },
      );
    }

    it('releases every transitive dependent of the named workspaces and leaves the others out', () => {
      const config = stubChainWorkspaces();
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add utility', 'abc123']], bump: 'minor' },
        'app-v': { previousTag: 'app-v2.0.0' },
        'cli-v': { previousTag: 'cli-v3.0.0', commits: [['feat: add flag', 'def456']], bump: 'minor' },
        'util-v': { previousTag: 'util-v0.1.0', commits: [['fix: util fix', 'fed789']], bump: 'patch' },
      });

      const result = prepareMonorepo(config, { onlyTargetIds: ['core'] });

      expect(result.tags).toStrictEqual(['core-v1.1.0', 'app-v2.0.1', 'cli-v3.1.0']);
      expect(selectPackageResults(result).map((workspace) => workspace.name)).toStrictEqual(['core', 'app', 'cli']);
      expect(selectPackageResults(result).find((c) => c.name === 'app')).toMatchObject({ propagatedOnly: true });
      expect(selectPackageResults(result).find((c) => c.name === 'cli')).toMatchObject({ releaseType: 'minor' });
      expect(selectPackageResults(result).find((c) => c.name === 'cli')).not.toHaveProperty('propagatedOnly');
    });

    it('forces only the named workspaces, leaving their dependents to propagation', () => {
      const config = stubChainWorkspaces();
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0' },
        'app-v': { previousTag: 'app-v2.0.0' },
        'cli-v': { previousTag: 'cli-v3.0.0' },
        'util-v': { previousTag: 'util-v0.1.0' },
      });

      const result = prepareMonorepo(config, { onlyTargetIds: ['core'], shouldForce: true });

      expect(result.tags).toStrictEqual(['core-v1.0.1', 'app-v2.0.1', 'cli-v3.0.1']);
      expect(selectPackageResults(result).find((c) => c.name === 'app')).toMatchObject({ propagatedOnly: true });
      expect(selectPackageResults(result).find((c) => c.name === 'cli')).toMatchObject({ propagatedOnly: true });
    });

    it('reports a dependent as skipped when the named workspace does not release', () => {
      const config = stubChainWorkspaces();
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0' },
        'app-v': { previousTag: 'app-v2.0.0' },
        'cli-v': { previousTag: 'cli-v3.0.0' },
        'util-v': { previousTag: 'util-v0.1.0', commits: [['fix: util fix', 'fed789']], bump: 'patch' },
      });

      const result = prepareMonorepo(config, { onlyTargetIds: ['core'] });

      expect(result.tags).toStrictEqual([]);
      expect(selectPackageResults(result).map((workspace) => [workspace.name, workspace.status])).toStrictEqual([
        ['core', 'skipped'],
        ['app', 'skipped'],
        ['cli', 'skipped'],
      ]);
    });

    it('starts the release from a --set-version workspace that --only does not name', () => {
      const config = stubChainWorkspaces();
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0' },
        'app-v': { previousTag: 'app-v2.0.0' },
        'cli-v': { previousTag: 'cli-v3.0.0' },
        'util-v': { previousTag: 'util-v0.1.0', commits: [['fix: util fix', 'fed789']], bump: 'patch' },
      });

      const result = prepareMonorepo(config, {
        onlyTargetIds: ['util'],
        versionOverridesById: new Map([['app', '3.0.0']]),
      });

      expect(result.tags).toStrictEqual(['app-v3.0.0', 'util-v0.1.1', 'cli-v3.0.1']);
      expect(selectPackageResults(result).find((c) => c.name === 'cli')).toMatchObject({
        propagatedFrom: [{ packageName: '@test/app', newVersion: '3.0.0' }],
      });
    });
  });

  describe('dependency propagation (continued)', () => {
    it('preserves a direct higher bump when propagation would add a patch', () => {
      const config = stubPropagationWorkspaces();

      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['fix: core fix', 'abc123']], bump: 'patch' },
        'app-v': { previousTag: 'app-v2.0.0', commits: [['feat: app feature', 'def456']], bump: 'minor' },
      });

      const result = prepareMonorepo(config, {});

      // app has its own minor bump from commits; propagation adds metadata but keeps minor.
      const appResult = selectPackageResults(result).find((c) => c.name === 'app');
      expect(appResult).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        propagatedFrom: [{ packageName: '@test/core', newVersion: '1.0.1' }],
      });
      expect(appResult).not.toHaveProperty('propagatedOnly');
    });
  });

  describe('unrouted entry scopes', () => {
    const blockMessage = [
      '#859 release-kit|feat: Route entries (#43)',
      '',
      '```change-record',
      'entries:',
      '  - type: feat',
      '    scopes: [arrays]',
      '    text: Adds to arrays.',
      '  - type: fix',
      '    scopes: [strings]',
      '    text: Fixes strings.',
      '  - type: fix',
      '    scopes: [nothing]',
      '    text: Fixes nothing.',
      '```',
    ].join('\n');
    const blockCommit = {
      hash: 'fff9999',
      subject: '#859 release-kit|feat: Route entries (#43)',
      body: '',
      message: blockMessage,
    };
    const unroutedFinding = (entryPosition: number, scope: string): UnroutedEntryScope => ({
      commitHash: 'fff9999',
      commitSubject: blockCommit.subject,
      entryPosition,
      scope,
    });

    it('attaches the scopes that route nowhere to every released and skipped workspace whose window has the commit', () => {
      const config = makeConfig({
        workspaces: [makeRoutedWorkspace('arrays'), makeRoutedWorkspace('core'), makeRoutedWorkspace('strings')],
      });
      stubWindows({ 'arrays-v': 'minor', 'core-v': undefined, 'strings-v': 'patch' }, ['arrays-v', 'core-v']);
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = prepareMonorepo(config, {});

      const expectedEntryScopes = [unroutedFinding(2, 'strings'), unroutedFinding(3, 'nothing')];
      expect(selectPackageResults(result).find((w) => w.name === 'arrays')).toMatchObject({
        status: 'released',
        unroutedEntryScopes: expectedEntryScopes,
      });
      expect(selectPackageResults(result).find((w) => w.name === 'core')).toMatchObject({
        status: 'skipped',
        unroutedEntryScopes: expectedEntryScopes,
      });
      expect(selectPackageResults(result).find((w) => w.name === 'strings')).not.toHaveProperty('unroutedEntryScopes');
    });

    it('does not report a configured workspace that --only left out of the run', () => {
      const config = makeConfig({ workspaces: [makeRoutedWorkspace('arrays'), makeRoutedWorkspace('strings')] });
      stubWindows({ 'arrays-v': 'minor', 'strings-v': 'patch' }, ['arrays-v']);
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = prepareMonorepo(config, { onlyTargetIds: ['arrays'] });

      expect(selectPackageResults(result).map((workspace) => workspace.name)).toStrictEqual(['arrays']);
      expect(selectPackageResults(result)[0]?.unroutedEntryScopes).toStrictEqual([unroutedFinding(3, 'nothing')]);
    });

    /** Stubs each prefix's history with its bump, putting the block commit in the windows of `blockPrefixes`. */
    function stubWindows(bumps: Record<string, ReleaseType | undefined>, blockPrefixes: readonly string[]): void {
      mockReadReleaseHistory.mockImplementation((_config: unknown, options: { tagPrefixes: readonly string[] }) => {
        const prefix = options.tagPrefixes[0] ?? '';
        const history = makeReleaseHistory({ previousTag: `${prefix}1.0.0`, bump: bumps[prefix] });
        history.unreleasedReading.commits = blockPrefixes.includes(prefix) ? [blockCommit] : [];
        return history;
      });
    }
  });
});
