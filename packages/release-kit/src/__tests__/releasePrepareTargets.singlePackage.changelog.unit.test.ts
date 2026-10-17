import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyReleasePrepareTargetsSinglePackageDefaults,
  featureSection,
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
  resetReleasePrepareTargetsSinglePackageMocks,
  stubFiles,
  stubHistory,
  stubMinorRelease,
  stubPackageVersion,
} = await vi.hoisted(() => import('../test-utils/releasePrepareTargetsSinglePackageMocks.ts'));

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

// Stub the history reader and the changelog writers so that the tests don't read git history or touch the filesystem.
vi.mock(import('../buildChangelogEntries.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readReleaseHistory: mockReadReleaseHistory,
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
import { buildEmptyReleaseEntry } from '../buildEmptyReleaseEntry.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import { selectPackageResults } from '../test-utils/prepareResults.ts';
import {
  diagnostics,
  makeConfig,
  prepareSinglePackage,
  type SinglePackageOptions,
} from '../test-utils/releasePrepareTargetsSinglePackageFixtures.ts';
import type { ChangelogEntry } from '../types.ts';

describe('releasePrepareTargets for a single-package repo', () => {
  beforeEach(() => {
    applyReleasePrepareTargetsSinglePackageDefaults();
  });

  afterEach(() => {
    resetReleasePrepareTargetsSinglePackageMocks();
    vi.restoreAllMocks();
  });

  describe("window that doesn't yield an item (--force / --set-version)", () => {
    /** Stubs a history whose tag doesn't have any commits above it, over a package at 1.0.0. */
    function stubEmptyRange(): void {
      stubHistory({ previousTag: 'v1.0.0' });
      stubPackageVersion('1.0.0');
    }

    it('writes a synthetic Notes / Forced version bump entry when --force is used without any commits', () => {
      stubEmptyRange();

      const result = prepareSinglePackage(makeConfig(), { force: true });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      const workspace = selectPackageResults(result)[0];
      assert(workspace?.status === 'released', 'expected released');
      expect(workspace.releaseType).toBe('patch');
      expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);

      // The empty-range branch builds a synthetic entry and passes it to the markdown renderer;
      // assert on the entries that the renderer received rather than the literal file bytes
      // (the writer is mocked).
      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            version: '1.0.1',
            sections: [
              expect.objectContaining({
                title: 'Notes',
                items: [expect.objectContaining({ description: 'Forced version bump.' })],
              }),
            ],
          }),
        ],
        expect.anything(),
      );
    });

    it('releases at the --bump level under --force --bump without any commits', () => {
      stubEmptyRange();

      const result = prepareSinglePackage(makeConfig(), { force: true, bumpOverride: 'minor' });

      expect(result.tags).toStrictEqual(['v1.1.0']);
      expect(selectPackageResults(result)[0]).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        bumpOverride: 'minor',
        commitCount: 0,
      });
      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        [expect.objectContaining({ version: '1.1.0' })],
        expect.anything(),
      );
    });

    it.each([
      ['--force', { force: true }, '1.0.1'],
      ['--set-version', { setVersion: '2.0.0' }, '2.0.0'],
    ])(
      "writes the synthetic entry under %s when the window has commits but doesn't yield an item",
      (_label, options, version) => {
        stubHistory({
          previousTag: 'v1.0.0',
          commits: [
            ['fmt: reformat', 'abc123'],
            ['update readme', 'def456'],
          ],
        });
        stubPackageVersion('1.0.0');

        prepareSinglePackage(makeConfig(), options);

        expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
          [{ ...buildEmptyReleaseEntry(version, ''), date: expect.any(String) }],
          expect.anything(),
        );
      },
    );

    it("upserts the synthetic entry into changelog.json ahead of the history's released entries", () => {
      stubHistory({
        previousTag: 'v1.0.0',
        releasedEntries: [{ version: '1.0.0', date: '2023-12-01', sections: [featureSection] }],
      });
      stubPackageVersion('1.0.0');

      prepareSinglePackage(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
        force: true,
      });

      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
      const upsertEntries = mockRenderChangelogJson.mock.calls[0]?.[0];
      expect(upsertEntries).toMatchObject([
        {
          version: '1.0.1',
          sections: [
            {
              title: 'Notes',
              audience: 'dev',
              items: [{ description: 'Forced version bump.' }],
            },
          ],
        },
        { version: '1.0.0', sections: [featureSection] },
      ]);
    });

    it('returns the synthetic changelog path without writing it', () => {
      stubEmptyRange();

      const result = prepareSinglePackage(
        makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        {
          force: true,
        },
      );

      expect(result.tags).toStrictEqual(['v1.0.1']);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
      const workspace = selectPackageResults(result)[0];
      assert(workspace?.status === 'released', 'expected released');
      expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);
    });

    it('appends synthetic CHANGELOG.md and changelog.json paths to formatCommand.files', () => {
      stubEmptyRange();
      const config = makeConfig({
        formatCommand: 'npx prettier --write',
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });

      const result = prepareSinglePackage(config, { force: true });

      expect(result.formatCommand?.files).toContain('CHANGELOG.md');
      expect(result.formatCommand?.files).toContain('./.meta/changelog.json');
    });
  });

  it('plans the --set-version tag without writing any file', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = prepareSinglePackage(makeConfig(), { setVersion: '1.0.0' });

    expect(result.tags).toStrictEqual(['v1.0.0']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  describe('diagnostics', () => {
    it('omits every diagnostic when the history reports none', () => {
      stubMinorRelease();

      const result = prepareSinglePackage(makeConfig(), {});

      const workspace = selectPackageResults(result)[0];
      expect(workspace?.malformedBlocks).toBeUndefined();
      expect(workspace?.policyViolations).toBeUndefined();
      expect(workspace?.undeclaredEntryTypes).toBeUndefined();
    });

    it("attaches the history's diagnostics to the released result", () => {
      stubHistory({ previousTag: 'v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor', diagnostics });
      stubPackageVersion('1.0.0');

      const result = prepareSinglePackage(makeConfig(), {});

      expect(selectPackageResults(result)[0]).toMatchObject({ status: 'released', ...diagnostics });
    });
  });

  describe('existing CHANGELOG.md sections', () => {
    const existingChangelog = [
      '# Changelog',
      '',
      '## Unreleased',
      '',
      '- pending',
      '',
      '## 1.0.0 — 2023-12-01',
      '',
      '- Stale text for a version the entries render',
      '',
      '## 0.9.0',
      '',
      '- Hand-written',
      '',
    ].join('\n');
    const releasedEntry: ChangelogEntry = {
      version: '1.0.0',
      date: '2023-12-01',
      sections: [{ title: 'Bug fixes', audience: 'all', items: [{ description: 'Fix bug' }] }],
    };

    it('keeps the sections whose versions the entries lack and reports them', () => {
      stubHistory({
        previousTag: 'v1.0.0',
        commits: [['feat: add feature', 'abc123']],
        bump: 'minor',
        sections: [featureSection],
        releasedEntries: [releasedEntry],
      });
      stubFiles({ 'package.json': JSON.stringify({ version: '1.0.0' }), 'CHANGELOG.md': existingChangelog });

      const result = prepareSinglePackage(makeConfig(), {});

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledExactlyOnceWith(
        [expect.objectContaining({ version: '1.1.0' }), releasedEntry],
        expect.objectContaining({ preservedSections: [{ version: '0.9.0', text: '## 0.9.0\n\n- Hand-written' }] }),
      );
      expect(selectPackageResults(result)[0]).toMatchObject({
        changelogPreservation: [
          { file: 'CHANGELOG.md', preservedVersions: ['0.9.0'], droppedUnversionedHeadings: ['## Unreleased'] },
        ],
      });
    });

    it('treats a version in changelog.json as rendered from the entries', () => {
      stubHistory({
        previousTag: 'v1.0.0',
        commits: [['feat: add feature', 'abc123']],
        bump: 'minor',
        sections: [featureSection],
        releasedEntries: [releasedEntry],
      });
      stubFiles({ 'package.json': JSON.stringify({ version: '1.0.0' }), 'CHANGELOG.md': existingChangelog });
      mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: ChangelogEntry[]) => [
        ...entries,
        { version: '0.9.0', date: '2023-06-01', sections: [] },
      ]);

      const result = prepareSinglePackage(makeConfig(), {});

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ preservedSections: [] }),
      );
      expect(selectPackageResults(result)[0]).toMatchObject({
        changelogPreservation: [
          { file: 'CHANGELOG.md', preservedVersions: [], droppedUnversionedHeadings: ['## Unreleased'] },
        ],
      });
    });

    it('omits changelogPreservation when the existing file has nothing to keep or drop', () => {
      stubMinorRelease();

      const result = prepareSinglePackage(makeConfig(), {});

      expect(selectPackageResults(result)[0]).not.toHaveProperty('changelogPreservation');
    });
  });

  describe('untagged baseline', () => {
    it.each<[string, SinglePackageOptions]>([
      ['a natural release', {}],
      ['--force', { force: true }],
      ['--set-version', { setVersion: '2.0.0' }],
    ])('throws on %s when the current version is recorded but untagged', (_label, options) => {
      stubHistory({ previousTag: 'v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
      stubFiles({ 'package.json': JSON.stringify({ version: '1.1.0' }), 'CHANGELOG.md': '## 1.1.0\n\n## 1.0.0\n' });

      expect(() => prepareSinglePackage(makeConfig(), options)).toThrow('  - package: 1.1.0 (create tag v1.1.0)');
    });

    it('throws even when the release would be skipped', () => {
      stubHistory({ previousTag: 'v1.0.0' });
      stubFiles({ 'package.json': JSON.stringify({ version: '1.1.0' }), 'CHANGELOG.md': '## 1.1.0\n' });

      expect(() => prepareSinglePackage(makeConfig(), {})).toThrow('create tag v1.1.0');
    });

    it('does not throw when the previous tag is the current version', () => {
      stubHistory({ previousTag: 'v1.1.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
      stubFiles({ 'package.json': JSON.stringify({ version: '1.1.0' }), 'CHANGELOG.md': '## 1.1.0\n' });

      expect(prepareSinglePackage(makeConfig(), {}).tags).toStrictEqual(['v1.2.0']);
    });
  });

  describe('changelogJson.enabled gating', () => {
    it('does not plan a changelog.json write when changelogJson.enabled is false', () => {
      stubMinorRelease();

      prepareSinglePackage(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false } }), {});

      expect(mockRenderChangelogJson).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
    });

    it('plans a changelog.json write when changelogJson.enabled is true', () => {
      stubMinorRelease();

      const plan = prepareSinglePackage(
        makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        {},
      );

      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
      expect(plan.writes.map((write) => write.path)).toContain('./.meta/changelog.json');
    });
  });
});
