import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPrepareReleaseTargetsProjectDefaults,
  expectOneHistoryRead,
  mockCopyFileSync,
  mockExecFileSync,
  mockExistsSync,
  mockMergeChangelogEntriesWithDisk,
  mockMkdirSync,
  mockMkdtempSync,
  mockPlanReleaseNotesPreviews,
  mockReadFileSync,
  mockReadReleaseHistory,
  mockRenderChangelogJson,
  mockRenderChangelogMarkdown,
  mockRmSync,
  mockWriteFileSync,
  resetPrepareReleaseTargetsProjectMocks,
  stubFiles,
  stubHistory,
} = await vi.hoisted(() => import('../test-utils/prepareReleaseTargetsProjectMocks.ts'));

vi.mock(import('node:child_process'), () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock(import('node:fs'), () => ({
  copyFileSync: mockCopyFileSync,
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  mkdtempSync: mockMkdtempSync,
  readFileSync: mockReadFileSync,
  rmSync: mockRmSync,
  writeFileSync: mockWriteFileSync,
}));

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

vi.mock(import('../planReleaseNotesPreviews.ts'), () => ({
  planReleaseNotesPreviews: mockPlanReleaseNotesPreviews,
}));

import { buildEmptyReleaseEntry } from '../buildEmptyReleaseEntry.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import type { PlannedWrite } from '../releasePlan.ts';
import {
  ENTRY_VIOLATION,
  makeConfig,
  MALFORMED_BLOCK,
  NEW_ENTRY,
  prepareProjectStage,
  RELEASED_ENTRY,
  stubDefaultHistory,
  UNDECLARED_ENTRY_TYPE,
} from '../test-utils/prepareReleaseTargetsProjectFixtures.ts';

describe('prepareReleaseTargets for a project composite', () => {
  beforeEach(() => {
    applyPrepareReleaseTargetsProjectDefaults();
  });

  afterEach(() => {
    resetPrepareReleaseTargetsProjectMocks();
  });

  describe('existing CHANGELOG.md sections', () => {
    it('keeps the root sections whose versions the entries lack and reports them', () => {
      stubDefaultHistory({ releasedEntries: [RELEASED_ENTRY] });
      stubFiles({
        './package.json': JSON.stringify({ name: 'root', version: '0.9.0' }),
        'CHANGELOG.md': '# Changelog\n\n## 0.9.0\n\n- Stale\n\n## 0.8.0\n\n- Hand-written\n\n## Credits\n\n- People\n',
      });

      const result = prepareProjectStage({
        config: makeConfig(),
        options: {},
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledExactlyOnceWith(
        [NEW_ENTRY, RELEASED_ENTRY],
        expect.objectContaining({ preservedSections: [{ version: '0.8.0', text: '## 0.8.0\n\n- Hand-written' }] }),
      );
      expect(result).toMatchObject({
        status: 'released',
        changelogPreservation: [
          { file: 'CHANGELOG.md', preservedVersions: ['0.8.0'], droppedUnversionedHeadings: ['## Credits'] },
        ],
      });
    });

    it("omits changelogPreservation when the root changelog doesn't exist", () => {
      stubDefaultHistory();

      const result = prepareProjectStage({
        config: makeConfig(),
        options: {},
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      expect(result).not.toHaveProperty('changelogPreservation');
    });
  });

  describe('untagged baseline', () => {
    it.each<[string, boolean]>([
      ['a natural release', false],
      ['--force', true],
    ])('throws on %s when the root version is recorded but untagged', (_label, shouldForce) => {
      stubDefaultHistory();
      stubFiles({ './package.json': JSON.stringify({ version: '1.0.0' }), 'CHANGELOG.md': '## 1.0.0\n' });
      const writes: PlannedWrite[] = [];

      expect(() =>
        prepareProjectStage({ config: makeConfig(), options: { shouldForce }, modifiedFiles: [], writes, tags: [] }),
      ).toThrow('  - project: 1.0.0 (create tag v1.0.0)');
      expect(writes).toStrictEqual([]);
    });

    it('does not throw when the previous tag is the root version', () => {
      stubDefaultHistory();
      stubFiles({ './package.json': JSON.stringify({ version: '0.9.0' }), 'CHANGELOG.md': '## 0.9.0\n' });

      const result = prepareProjectStage({
        config: makeConfig(),
        options: {},
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      expect(result.status).toBe('released');
    });
  });

  describe("project release whose window doesn't yield an item", () => {
    // When `--force` triggers a project release although the unreleased window doesn't yield a
    // changelog item, a synthetic "Notes / Forced version bump." entry stands in for that window.

    it('writes a synthetic Notes / Forced version bump entry for the root CHANGELOG when --force is used without any commits', () => {
      stubHistory({ previousTag: 'v0.9.0' });
      const tags: string[] = [];
      const modifiedFiles: string[] = [];

      const result = prepareProjectStage({
        config: makeConfig(),
        options: { shouldForce: true },
        modifiedFiles,
        writes: [],
        tags,
      });

      assert(result.status === 'released', 'expected released');
      expect(result.tag).toBe('v0.9.1');
      expect(result.changelogFiles).toContain('CHANGELOG.md');
      expect(tags).toStrictEqual(['v0.9.1']);

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            version: '0.9.1',
            sections: expect.arrayContaining([
              expect.objectContaining({
                title: 'Notes',
                items: expect.arrayContaining([expect.objectContaining({ description: 'Forced version bump.' })]),
              }),
            ]),
          }),
        ]),
        expect.anything(),
      );
    });

    it("writes the synthetic entry under --force when the window has commits but doesn't yield an item", () => {
      stubHistory({
        previousTag: 'v0.9.0',
        commits: [
          ['fmt: reformat', 'abc123'],
          ['update readme', 'def456'],
        ],
      });

      prepareProjectStage({
        config: makeConfig(),
        options: { shouldForce: true },
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        [{ ...buildEmptyReleaseEntry('0.9.1', ''), date: expect.any(String) }],
        expect.anything(),
      );
    });

    it("reads the history once and renders the synthetic entry ahead of the history's released entries", () => {
      stubHistory({ previousTag: 'v0.9.0', releasedEntries: [RELEASED_ENTRY] });
      const config = makeConfig();

      prepareProjectStage({
        config,
        options: { shouldForce: true },
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      expectOneHistoryRead(config, ['packages/arrays/**', 'packages/strings/**']);
      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
        [expect.objectContaining({ version: '0.9.1' }), RELEASED_ENTRY],
        expect.anything(),
      );
    });

    it('writes a synthetic empty-range entry into the root changelog.json when enabled', () => {
      stubHistory({ previousTag: 'v0.9.0' });
      const config = makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } });

      prepareProjectStage({
        config,
        options: { shouldForce: true },
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
      const writeEntries = mockRenderChangelogJson.mock.calls[0]?.[0];
      expect(writeEntries).toStrictEqual([
        expect.objectContaining({
          version: '0.9.1',
          sections: expect.arrayContaining([
            expect.objectContaining({
              title: 'Notes',
              items: expect.arrayContaining([expect.objectContaining({ description: 'Forced version bump.' })]),
            }),
          ]),
        }),
      ]);
    });

    it('plans the synthetic files without writing them, and still appends tag and modified files', () => {
      stubHistory({ previousTag: 'v0.9.0' });
      const tags: string[] = [];
      const modifiedFiles: string[] = [];
      const writes: PlannedWrite[] = [];

      const result = prepareProjectStage({
        config: makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        options: { shouldForce: true },
        modifiedFiles,
        writes,
        tags,
      });

      assert(result.status === 'released', 'expected released');
      expect(tags).toStrictEqual(['v0.9.1']);
      expect(modifiedFiles).toContain('CHANGELOG.md');
      expect(modifiedFiles).toContain('./.meta/changelog.json');
      expect(writes.map((write) => write.path)).toStrictEqual([
        './package.json',
        './.meta/changelog.json',
        'CHANGELOG.md',
      ]);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("renders a window that yields items from the history's entries, without a synthetic entry", () => {
      stubDefaultHistory();

      prepareProjectStage({
        config: makeConfig(),
        options: { shouldForce: true },
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith([NEW_ENTRY], expect.anything());
    });

    it('leaves a skipped-project result unchanged (no synthetic entries for skipped projects)', () => {
      stubHistory({ previousTag: 'v0.9.0' });
      const tags: string[] = [];
      const modifiedFiles: string[] = [];

      const result = prepareProjectStage({
        config: makeConfig(),
        options: {}, // No --force, no --bump → skip path.
        modifiedFiles,
        writes: [],
        tags,
      });

      expect(result.status).toBe('skipped');
      expect(tags).toStrictEqual([]);
      expect(modifiedFiles).toStrictEqual([]);
      expect(mockRenderChangelogMarkdown).not.toHaveBeenCalled();
    });
  });

  describe('changelog diagnostics', () => {
    it('omits every diagnostic list from a released result when the history reports none', () => {
      stubDefaultHistory();

      const result = prepareProjectStage({
        config: makeConfig(),
        options: {},
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      assert(result.status === 'released', 'expected released');
      expect(result.malformedBlocks).toBeUndefined();
      expect(result.policyViolations).toBeUndefined();
      expect(result.undeclaredEntryTypes).toBeUndefined();
    });

    it("attaches the history's diagnostics to a released result as they are", () => {
      stubDefaultHistory({
        diagnostics: {
          malformedBlocks: [MALFORMED_BLOCK],
          policyViolations: [ENTRY_VIOLATION],
          undeclaredEntryTypes: [UNDECLARED_ENTRY_TYPE],
        },
      });

      const result = prepareProjectStage({
        config: makeConfig(),
        options: {},
        modifiedFiles: [],
        writes: [],
        tags: [],
      });

      assert(result.status === 'released', 'expected released');
      expect(result.malformedBlocks).toStrictEqual([MALFORMED_BLOCK]);
      expect(result.policyViolations).toStrictEqual([ENTRY_VIOLATION]);
      expect(result.undeclaredEntryTypes).toStrictEqual([UNDECLARED_ENTRY_TYPE]);
    });
  });
});
