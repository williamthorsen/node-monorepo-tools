import { captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyReleasePrepareTargetsMonorepoDefaults,
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
  resetReleasePrepareTargetsMonorepoMocks,
  stubHistory,
  stubHistoryByPrefix,
} = await vi.hoisted(() => import('../test-utils/releasePrepareTargetsMonorepoMocks.ts'));

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
// deterministic values without reading git history or touching the filesystem; `toChangelogEntries`
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

import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import { selectPackageResults } from '../test-utils/prepareResults.ts';
import { makeConfig, prepareMonorepo } from '../test-utils/releasePrepareTargetsMonorepoFixtures.ts';
import type { MalformedChangeRecordBlock, PolicyViolation, UndeclaredEntryType, WorkspaceConfig } from '../types.ts';

describe('releasePrepareTargets for a monorepo', () => {
  beforeEach(() => {
    applyReleasePrepareTargetsMonorepoDefaults();
  });

  afterEach(() => {
    resetReleasePrepareTargetsMonorepoMocks();
  });

  describe('opportunistic hint when baseline is missing', () => {
    /** Configures mocks for a single workspace without a baseline tag and a commit that calls for a minor bump. */
    function setupNoBaseline(tagListOutput: string[]): void {
      stubHistory({ commits: [['feat: add', 'abc']], bump: 'minor' });
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') {
          return tagListOutput.join('\n') + (tagListOutput.length > 0 ? '\n' : '');
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
    }

    it("emits a hint when the workspace doesn't have a baseline, candidate tags exist, and legacyIdentities is empty", () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            paths: ['packages/core/**'],
          },
        ],
      });
      setupNoBaseline(['core-v0.2.7', 'core-v0.2.8']);
      using stdioCapture = captureStdio();

      prepareMonorepo(config, {});

      expect(stdioCapture.stderrChunks).toHaveLength(1);
      const message = stdioCapture.stderrChunks[0] ?? '';
      expect(message).toContain("no baseline tag found for core under 'nmr-core-v'");
      expect(message).toContain('candidate-shaped tags');
      expect(message).toContain('core-v0.2.7');
      expect(message).toContain('show-tag-prefixes');
    });

    it('suppresses the hint when legacyIdentities is non-empty', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            paths: ['packages/core/**'],
            legacyIdentities: [{ name: '@old-scope/core', tagPrefix: 'core-v' }],
          },
        ],
      });
      setupNoBaseline(['core-v0.2.7']);
      using stdioCapture = captureStdio();

      prepareMonorepo(config, {});

      expect(stdioCapture.stderrChunks).toHaveLength(0);
    });

    it("suppresses the hint when the repo doesn't have any candidate-shaped tags", () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            paths: ['packages/core/**'],
          },
        ],
      });
      setupNoBaseline([]);
      using stdioCapture = captureStdio();

      prepareMonorepo(config, {});

      expect(stdioCapture.stderrChunks).toHaveLength(0);
    });

    it("treats sibling workspaces' derived prefixes as known (not undeclared candidates)", () => {
      // Sibling workspaces' tags are known prefixes, not "undeclared candidates": the hint must NOT
      // fire when the only candidate-shaped tags in the repo belong to other configured workspaces.
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'node-monorepo-arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      // Only tags in the repo belong to the sibling `arrays` workspace. `core` doesn't have a baseline.
      setupNoBaseline(['node-monorepo-arrays-v1.0.0', 'node-monorepo-arrays-v1.1.0']);
      using stdioCapture = captureStdio();

      prepareMonorepo(config, {});

      expect(stdioCapture.stderrChunks).toHaveLength(0);
    });

    it("treats sibling workspaces' declared legacyIdentities as known", () => {
      // A sibling workspace's declared legacy prefixes must not show up as undeclared candidates
      // when another workspace doesn't have a baseline.
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'node-monorepo-arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
            legacyIdentities: [{ name: '@old-scope/arrays', tagPrefix: 'arrays-v' }],
          },
        ],
      });
      setupNoBaseline(['arrays-v0.5.0', 'arrays-v0.6.0']);
      using stdioCapture = captureStdio();

      prepareMonorepo(config, {});

      expect(stdioCapture.stderrChunks).toHaveLength(0);
    });

    it('prints at most one hint per prepare run even with multiple triggering workspaces', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'core',
            name: '@test/core',
            tagPrefix: 'nmr-core-v',
            workspacePath: 'packages/core',
            isPublishable: true,
            packageFiles: ['packages/core/package.json'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'node-monorepo-arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
      });
      setupNoBaseline(['core-v0.2.7', 'arrays-v0.1.0']);
      using stdioCapture = captureStdio();

      prepareMonorepo(config, {});

      expect(stdioCapture.stderrChunks).toHaveLength(1);
    });
  });

  describe('changelog diagnostics', () => {
    function makeWorkspace(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
      return {
        dir: 'arrays',
        name: '@test/arrays',
        tagPrefix: 'arrays-v',
        workspacePath: 'packages/arrays',
        isPublishable: true,
        packageFiles: ['packages/arrays/package.json'],
        paths: ['packages/arrays/**'],
        ...overrides,
      };
    }

    const malformedBlock: MalformedChangeRecordBlock = {
      commitHash: 'aaa1111',
      commitSubject: 'Squash',
      reason: '`entries` is not a list',
    };
    const undeclaredEntryType: UndeclaredEntryType = {
      commitHash: 'bbb2222',
      commitSubject: 'Merge PR',
      entryPosition: 2,
      type: 'chore',
    };
    const prefixViolation: PolicyViolation = {
      commitHash: 'def5678',
      commitSubject: 'internal!: refactor cache',
      type: 'internal',
      surface: 'prefix',
    };
    const entryViolation: PolicyViolation = {
      commitHash: 'bbb2222',
      commitSubject: 'Merge PR',
      type: 'drop',
      surface: 'entry',
      entryPosition: 1,
    };

    it('reads each history with the run config, whose breaking policies decide the violations', () => {
      const config = makeConfig({ workspaces: [makeWorkspace()], breakingPolicies: {} });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat: add', 'abc1234']], bump: 'minor' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      prepareMonorepo(config, {});

      expect(mockReadReleaseHistory).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ breakingPolicies: {} }),
        expect.any(Object),
      );
    });

    it('omits every diagnostic list that the history leaves empty', () => {
      const config = makeConfig({ workspaces: [makeWorkspace()] });
      stubHistory({ previousTag: 'arrays-v1.0.0', commits: [['feat!: drop legacy export', 'abc1234']], bump: 'major' });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = prepareMonorepo(config, {});

      expect(selectPackageResults(result)[0]?.status).toBe('released');
      expect(selectPackageResults(result)[0]?.malformedBlocks).toBeUndefined();
      expect(selectPackageResults(result)[0]?.policyViolations).toBeUndefined();
      expect(selectPackageResults(result)[0]?.undeclaredEntryTypes).toBeUndefined();
    });

    it("attaches the history's diagnostics to a released result", () => {
      const config = makeConfig({ workspaces: [makeWorkspace()] });
      stubHistory({
        previousTag: 'arrays-v1.0.0',
        commits: [['internal!: refactor cache', 'def5678']],
        bump: 'patch',
        diagnostics: {
          malformedBlocks: [malformedBlock],
          policyViolations: [prefixViolation, entryViolation],
          undeclaredEntryTypes: [undeclaredEntryType],
        },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = prepareMonorepo(config, {});

      expect(selectPackageResults(result)[0]).toMatchObject({
        status: 'released',
        malformedBlocks: [malformedBlock],
        undeclaredEntryTypes: [undeclaredEntryType],
        policyViolations: [prefixViolation, entryViolation],
      });
    });

    it("attaches the history's diagnostics to a skipped result", () => {
      const config = makeConfig({ workspaces: [makeWorkspace()] });
      stubHistory({
        previousTag: 'arrays-v1.0.0',
        commits: [['Merge PR', 'bbb2222']],
        diagnostics: {
          malformedBlocks: [malformedBlock],
          policyViolations: [entryViolation],
          undeclaredEntryTypes: [undeclaredEntryType],
        },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = prepareMonorepo(config, {});

      expect(selectPackageResults(result)[0]).toMatchObject({
        status: 'skipped',
        malformedBlocks: [malformedBlock],
        undeclaredEntryTypes: [undeclaredEntryType],
        policyViolations: [entryViolation],
      });
    });

    it('attaches diagnostics only to the workspace whose history reported them', () => {
      const cleanWorkspace = makeWorkspace({
        dir: 'core',
        name: '@test/core',
        tagPrefix: 'core-v',
        workspacePath: 'packages/core',
        packageFiles: ['packages/core/package.json'],
        paths: ['packages/core/**'],
      });
      const config = makeConfig({ workspaces: [makeWorkspace(), cleanWorkspace] });
      stubHistoryByPrefix({
        'arrays-v': {
          previousTag: 'arrays-v1.0.0',
          commits: [['internal!: refactor cache', 'def5678']],
          bump: 'patch',
          diagnostics: { policyViolations: [prefixViolation] },
        },
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add helper', 'aaa1111']], bump: 'minor' },
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = prepareMonorepo(config, {});

      const arraysResult = selectPackageResults(result).find((w) => w.name === 'arrays');
      const coreResult = selectPackageResults(result).find((w) => w.name === 'core');
      expect(arraysResult?.policyViolations).toStrictEqual([prefixViolation]);
      expect(coreResult?.policyViolations).toBeUndefined();
    });

    it('attaches the skipped history to a workspace that propagation promotes', () => {
      const coreWorkspace = makeWorkspace({
        dir: 'core',
        name: '@test/core',
        tagPrefix: 'core-v',
        workspacePath: 'packages/core',
        packageFiles: ['packages/core/package.json'],
        paths: ['packages/core/**'],
      });
      const config = makeConfig({ workspaces: [coreWorkspace, makeWorkspace()] });
      stubHistoryByPrefix({
        'core-v': { previousTag: 'core-v1.0.0', commits: [['feat: add helper', 'aaa1111']], bump: 'minor' },
        'arrays-v': {
          previousTag: 'arrays-v1.0.0',
          commits: [
            ['Merge PR', 'bbb2222'],
            ['tidy up', 'ccc3333'],
          ],
          unparseableCommits: [['tidy up', 'ccc3333']],
          diagnostics: {
            malformedBlocks: [malformedBlock],
            policyViolations: [entryViolation],
            undeclaredEntryTypes: [undeclaredEntryType],
          },
        },
      });
      mockReadFileSync.mockImplementation((filePath: string) =>
        JSON.stringify(
          filePath.includes('arrays')
            ? { name: '@test/arrays', version: '1.0.0', dependencies: { '@test/core': 'workspace:*' } }
            : { name: '@test/core', version: '1.0.0' },
        ),
      );
      mockExistsSync.mockReturnValue(false);

      const result = prepareMonorepo(config, {});

      const arraysResult = selectPackageResults(result).find((w) => w.name === 'arrays');
      expect(arraysResult).toMatchObject({
        status: 'released',
        previousTag: 'arrays-v1.0.0',
        commitCount: 2,
        commits: makeStubbedCommits([
          ['Merge PR', 'bbb2222'],
          ['tidy up', 'ccc3333'],
        ]),
        unparseableCommits: makeStubbedCommits([['tidy up', 'ccc3333']]),
        malformedBlocks: [malformedBlock],
        undeclaredEntryTypes: [undeclaredEntryType],
        policyViolations: [entryViolation],
        propagatedOnly: true,
      });
      expect(arraysResult?.parsedCommitCount).toBeUndefined();
      expect(selectPackageResults(result).find((w) => w.name === 'core')).not.toHaveProperty('propagatedOnly');
      expect(mockBuildSyntheticChangelogEntry).toHaveBeenCalledTimes(1);
      expect(result.summary).toContain('arrays-v1.0.1\n- Merge PR\n- tidy up');
    });
  });

  describe('editorial overrides wiring', () => {
    // This group asserts the orchestrator's threading: The orchestrator adds the warnings produced
    // by `applyWorkspaceOverrides` to the final `PrepareResult.warnings` array.
    it('reports a per-workspace stale-key warning on PrepareResult.warnings', () => {
      const config = makeConfig({
        workspaces: [
          {
            dir: 'arrays',
            name: '@test/arrays',
            tagPrefix: 'arrays-v',
            workspacePath: 'packages/arrays',
            isPublishable: true,
            packageFiles: ['packages/arrays/package.json'],
            paths: ['packages/arrays/**'],
          },
        ],
      });

      // Stub the history: one commit since the previous tag, whose item has a known hash that
      // does NOT match the override key that the workspace file declares; the override is
      // therefore stale and the workspace-tier rule warns immediately.
      stubHistory({
        previousTag: 'arrays-v1.0.0',
        commits: [['feat: add utility', 'realcommithash']],
        bump: 'minor',
        sections: [
          { title: 'Features', audience: 'all', items: [{ description: 'Add utility', hash: 'realcommithash' }] },
        ],
      });

      // Expose the workspace's `.meta/changelog-overrides.json` to the loader. Every other
      // existsSync probe (e.g., for prettier config) returns false.
      const workspaceOverridePath = 'packages/arrays/.meta/changelog-overrides.json';
      mockExistsSync.mockImplementation((path: string) => path.endsWith(workspaceOverridePath));
      mockReadFileSync.mockImplementation((path: string) => {
        if (typeof path === 'string' && path.endsWith(workspaceOverridePath)) {
          return JSON.stringify({ deadaaa: { audience: 'skip' } });
        }
        return JSON.stringify({ name: '@test/arrays', version: '1.0.0' });
      });

      const result = prepareMonorepo(config, {});

      expect(result.warnings).toBeDefined();
      const warnings = result.warnings ?? [];
      expect(warnings.some((message) => message.includes("'deadaaa'"))).toBe(true);
      expect(warnings.some((message) => /stale reference/.test(message))).toBe(true);
    });
  });
});
