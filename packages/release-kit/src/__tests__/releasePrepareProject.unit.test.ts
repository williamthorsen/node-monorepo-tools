import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockMkdtempSync = vi.hoisted(() => vi.fn());
const mockRmSync = vi.hoisted(() => vi.fn());
const mockCopyFileSync = vi.hoisted(() => vi.fn());
const mockReadReleaseHistory = vi.hoisted(() => vi.fn());
const mockMergeChangelogEntriesWithDisk = vi.hoisted(() => vi.fn());
const mockRenderChangelogMarkdown = vi.hoisted(() => vi.fn());
const mockRenderChangelogJson = vi.hoisted(() => vi.fn());
const mockPlanReleaseNotesPreviews = vi.hoisted(() => vi.fn());

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
  renderChangelogMarkdown: mockRenderChangelogMarkdown,
}));

vi.mock(import('../planReleaseNotesPreviews.ts'), () => ({
  planReleaseNotesPreviews: mockPlanReleaseNotesPreviews,
}));

import { buildEmptyReleaseEntry } from '../buildEmptyReleaseEntry.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
import type { PlannedWrite } from '../releasePlan.ts';
import { releasePrepareProject } from '../releasePrepareProject.ts';
import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import { makeReleaseHistory, type ReleaseHistoryStub } from '../test-utils/releaseHistories.ts';
import type {
  ChangelogEntry,
  ChangelogSection,
  MalformedChangeRecordBlock,
  MonorepoReleaseConfig,
  PolicyViolation,
  UndeclaredEntryType,
  WorkspaceConfig,
} from '../types.ts';

/** The unreleased window's sections in the default history. */
const UNRELEASED_SECTIONS: ChangelogSection[] = [
  { title: 'Features', audience: 'all', items: [{ description: 'ship project', hash: 'abc123' }] },
];

/** A released window's entry, which the project changelog keeps below the new one. */
const RELEASED_ENTRY: ChangelogEntry = {
  version: '0.9.0',
  date: '2023-12-01',
  sections: [{ title: 'Bug fixes', audience: 'all', items: [{ description: 'patch arrays', hash: 'fed987' }] }],
};

/** The entry that the default history's unreleased window yields under the default release's tag. */
const NEW_ENTRY: ChangelogEntry = { version: '0.10.0', date: '2024-01-01', sections: UNRELEASED_SECTIONS };

const MALFORMED_BLOCK: MalformedChangeRecordBlock = {
  commitHash: 'aaa1111',
  commitSubject: 'Squash',
  reason: '`entries` is not a list',
};

const UNDECLARED_ENTRY_TYPE: UndeclaredEntryType = {
  commitHash: 'bbb2222',
  commitSubject: 'Merge PR',
  entryPosition: 2,
  type: 'chore',
};

const ENTRY_VIOLATION: PolicyViolation = {
  commitHash: 'bbb2222',
  commitSubject: 'Merge PR',
  type: 'drop',
  surface: 'entry',
  entryPosition: 1,
};

describe(releasePrepareProject, () => {
  beforeEach(() => {
    mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: unknown[]) => entries);
    mockRenderChangelogMarkdown.mockReturnValue('# Changelog\n');
    mockRenderChangelogJson.mockReturnValue('[]\n');
    mockPlanReleaseNotesPreviews.mockReturnValue({ writes: [], warnings: [] });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '0.9.0' }));
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockMkdtempSync.mockReset();
    mockRmSync.mockReset();
    mockCopyFileSync.mockReset();
    mockReadReleaseHistory.mockReset();
    mockMergeChangelogEntriesWithDisk.mockReset();
    mockRenderChangelogMarkdown.mockReset();
    mockRenderChangelogJson.mockReset();
    mockPlanReleaseNotesPreviews.mockReset();
  });

  it('returns a structured skipped result when no commits since the last project tag and no force', () => {
    stubHistory({ previousTag: 'v0.9.0' });
    const config = makeConfig();
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config,
      options: {},
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'skipped', 'expected skipped');
    expect(result.commitCount).toBe(0);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.previousTag).toBe('v0.9.0');
    expect(result.skipReason).toBe('No commits since v0.9.0. Pass --force to release at patch. Skipping.');
    expect(tags).toStrictEqual([]);
    expect(modifiedFiles).toStrictEqual([]);
    expectOneHistoryRead(config, ['packages/arrays/**', 'packages/strings/**']);
  });

  it("skips a window whose commits call for no bump, carrying the history's counts and diagnostics", () => {
    stubHistory({
      previousTag: 'v0.9.0',
      commits: [['chore: update deps', 'abc123']],
      unparseableCommits: [['chore: update deps', 'abc123']],
      diagnostics: {
        malformedBlocks: [MALFORMED_BLOCK],
        policyViolations: [ENTRY_VIOLATION],
        undeclaredEntryTypes: [UNDECLARED_ENTRY_TYPE],
      },
    });
    const config = makeConfig();
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config,
      options: {},
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'skipped', 'expected skipped');
    expect(result.commitCount).toBe(1);
    expect(result.previousTag).toBe('v0.9.0');
    expect(result.parsedCommitCount).toBe(0);
    expect(result.skipReason).toContain('No bump-worthy commits since v0.9.0');
    expect(result.skipReason).toContain('Pass --force to release at patch');
    expect(result.unparseableCommits).toStrictEqual(makeStubbedCommits([['chore: update deps', 'abc123']]));
    expect(result.malformedBlocks).toStrictEqual([MALFORMED_BLOCK]);
    expect(result.undeclaredEntryTypes).toStrictEqual([UNDECLARED_ENTRY_TYPE]);
    expect(result.policyViolations).toStrictEqual([ENTRY_VIOLATION]);
    expect(tags).toStrictEqual([]);
    expect(modifiedFiles).toStrictEqual([]);
    expectOneHistoryRead(config, ['packages/arrays/**', 'packages/strings/**']);
  });

  it('falls back to patch when --force is set with no commits (no --bump)', () => {
    stubHistory({ previousTag: 'v0.9.0' });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { force: true },
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'released', 'expected released');
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(result.commitCount).toBe(0);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.bumpOverride).toBeUndefined();
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it('releases at patch when --force is set on a window whose commits call for no bump', () => {
    stubHistory({
      previousTag: 'v0.9.0',
      commits: [['chore: update deps', 'abc123']],
      unparseableCommits: [['chore: update deps', 'abc123']],
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { force: true },
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'released', 'expected released');
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(result.commitCount).toBe(1);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.unparseableCommits).toStrictEqual(makeStubbedCommits([['chore: update deps', 'abc123']]));
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it('skips when --bump=X alone is set on a window whose commits call for no bump (level chooser, not trigger)', () => {
    stubHistory({ previousTag: 'v0.9.0', commits: [['chore: update deps', 'abc123']] });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { bumpOverride: 'minor' },
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'skipped', 'expected skipped');
    expect(result.skipReason).toContain('No bump-worthy commits since v0.9.0');
    expect(tags).toStrictEqual([]);
    expect(modifiedFiles).toStrictEqual([]);
  });

  it('bumps root package.json, writes ./CHANGELOG.md, appends tag, and appends modified files', () => {
    stubDefaultHistory();
    const config = makeConfig();
    const tags: string[] = [];
    const modifiedFiles: string[] = [];
    const writes: PlannedWrite[] = [];

    const result = releasePrepareProject({
      config,
      options: {},
      modifiedFiles,
      writes,
      tags,
    });

    assert(result.status === 'released', 'expected released');
    expect(result.tag).toBe('v0.10.0');
    expect(result.releaseType).toBe('minor');
    expect(result.currentVersion).toBe('0.9.0');
    expect(result.newVersion).toBe('0.10.0');
    expect(result.changelogFiles).toContain('CHANGELOG.md');

    expect(tags).toStrictEqual(['v0.10.0']);
    expect(modifiedFiles).toContain('./package.json');
    expect(modifiedFiles).toContain('CHANGELOG.md');

    // Root package.json is planned with the new version, and written by nobody here.
    expect(plannedContent(writes, './package.json')).toContain('"version": "0.10.0"');
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    expectOneHistoryRead(config, ['packages/arrays/**', 'packages/strings/**']);
  });

  it("labels the unreleased window's sections with the new tag, ahead of the released entries", () => {
    stubDefaultHistory({ releasedEntries: [RELEASED_ENTRY] });

    releasePrepareProject({
      config: makeConfig(),
      options: {},
      modifiedFiles: [],
      writes: [],
      tags: [],
    });

    expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith([NEW_ENTRY, RELEASED_ENTRY], expect.anything());
  });

  it('reads the history once under the resolved project paths', () => {
    stubDefaultHistory();
    const config = makeConfig({ project: { paths: ['packages/arrays/**'], tagPrefix: 'v' } });

    releasePrepareProject({
      config,
      options: {},
      modifiedFiles: [],
      writes: [],
      tags: [],
    });

    expectOneHistoryRead(config, ['packages/arrays/**']);
  });

  // The workspace union is resolved into `project.paths` at config load, so a declared value
  // must win here even when it disagrees with `config.workspaces`.
  it('ignores config.workspaces when resolving the window', () => {
    stubDefaultHistory();
    const config = makeConfig({ project: { paths: ['**'], tagPrefix: 'v' } });

    releasePrepareProject({
      config,
      options: {},
      modifiedFiles: [],
      writes: [],
      tags: [],
    });

    expectOneHistoryRead(config, ['**']);
  });

  it("uses bumpOverride instead of the history's bump", () => {
    stubDefaultHistory();
    // Use a 1.x baseline so the major bump is not collapsed by the pre-1.0 rule in `bumpVersion`.
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '1.5.2' }));
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { bumpOverride: 'major' },
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'released', 'expected released');
    expect(result.releaseType).toBe('major');
    expect(result.bumpOverride).toBe('major');
    expect(result.newVersion).toBe('2.0.0');
    expect(tags).toStrictEqual(['v2.0.0']);
  });

  it('runs with no commits when --force is set with --bump', () => {
    stubHistory({ previousTag: 'v0.9.0' });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: { force: true, bumpOverride: 'patch' },
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'released', 'expected released');
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it('plans the project release without writing any file', () => {
    stubDefaultHistory();
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: {},
      modifiedFiles,
      writes: [],
      tags,
    });

    assert(result.status === 'released', 'expected released');
    expect(result.tag).toBe('v0.10.0');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("renders the root changelog.json from the history's entries merged with the entries on disk", () => {
    const earlierForcedEntry: ChangelogEntry = {
      version: '0.8.1',
      date: '2023-11-01',
      sections: [{ title: 'Notes', audience: 'dev', items: [{ description: 'Forced version bump.' }] }],
    };
    mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: ChangelogEntry[]) => [
      ...entries,
      earlierForcedEntry,
    ]);
    stubDefaultHistory({ releasedEntries: [RELEASED_ENTRY] });
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });
    const modifiedFiles: string[] = [];

    releasePrepareProject({
      config,
      options: {},
      modifiedFiles,
      writes: [],
      tags: [],
    });

    expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledExactlyOnceWith('./.meta/changelog.json', [
      NEW_ENTRY,
      RELEASED_ENTRY,
    ]);
    expect(mockRenderChangelogJson).toHaveBeenCalledExactlyOnceWith([NEW_ENTRY, RELEASED_ENTRY, earlierForcedEntry]);
    expect(modifiedFiles).toContain('./.meta/changelog.json');
  });

  it('emits release-notes previews when --with-release-notes is set and changelogJson.enabled', () => {
    stubDefaultHistory({ releasedEntries: [RELEASED_ENTRY] });
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    releasePrepareProject({
      config,
      options: { withReleaseNotes: true },
      modifiedFiles,
      writes: [],
      tags,
    });

    expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledTimes(1);
    expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '.',
        tag: 'v0.10.0',
        entries: [NEW_ENTRY, RELEASED_ENTRY],
        sectionOrder: expect.any(Array),
      }),
    );
  });

  it('does not emit release-notes previews when the flag is omitted', () => {
    stubDefaultHistory();
    const config = makeConfig({
      changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
    });

    releasePrepareProject({
      config,
      options: {},
      modifiedFiles: [],
      writes: [],
      tags: [],
    });

    expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
  });

  it("releases at the history's bump, reporting its baseline tag, commits, and counts", () => {
    stubHistory({
      previousTag: 'v0.9.0',
      commits: [
        ['fix: patch arrays bug', 'abc'],
        ['ship strings helper', 'def'],
      ],
      bump: 'minor',
      parsedCommitCount: 1,
      unparseableCommits: [['ship strings helper', 'def']],
      sections: UNRELEASED_SECTIONS,
    });
    const tags: string[] = [];

    const result = releasePrepareProject({
      config: makeConfig(),
      options: {},
      modifiedFiles: [],
      writes: [],
      tags,
    });

    assert(result.status === 'released', 'expected released');
    expect(result.previousTag).toBe('v0.9.0');
    expect(result.commitCount).toBe(2);
    expect(result.parsedCommitCount).toBe(1);
    expect(result.commits).toStrictEqual(
      makeStubbedCommits([
        ['fix: patch arrays bug', 'abc'],
        ['ship strings helper', 'def'],
      ]),
    );
    expect(result.unparseableCommits).toStrictEqual(makeStubbedCommits([['ship strings helper', 'def']]));
    expect(result.releaseType).toBe('minor');
    expect(result.newVersion).toBe('0.10.0');
    expect(tags).toStrictEqual(['v0.10.0']);
  });

  it('throws when called without a project block', () => {
    const config = makeConfig();
    delete config.project;
    expect(() =>
      releasePrepareProject({
        config,
        options: {},
        modifiedFiles: [],
        writes: [],
        tags: [],
      }),
    ).toThrow(/without a configured project block/);
    expect(mockReadReleaseHistory).not.toHaveBeenCalled();
  });

  describe('project release whose window yields no item', () => {
    // When `--force` triggers a project release although the unreleased window yields no
    // changelog item, a synthetic "Notes / Forced version bump." entry stands in for that window.

    it('writes a synthetic Notes / Forced version bump entry for the root CHANGELOG when --force is used with no commits', () => {
      stubHistory({ previousTag: 'v0.9.0' });
      const tags: string[] = [];
      const modifiedFiles: string[] = [];

      const result = releasePrepareProject({
        config: makeConfig(),
        options: { force: true },
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

    it('writes the synthetic entry under --force when the window has commits but yields no item', () => {
      stubHistory({
        previousTag: 'v0.9.0',
        commits: [
          ['fmt: reformat', 'abc123'],
          ['update readme', 'def456'],
        ],
      });

      releasePrepareProject({
        config: makeConfig(),
        options: { force: true },
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

      releasePrepareProject({
        config,
        options: { force: true },
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

      releasePrepareProject({
        config,
        options: { force: true },
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

      const result = releasePrepareProject({
        config: makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        options: { force: true },
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

    it("renders a window that yields items from the history's entries, with no synthetic entry", () => {
      stubDefaultHistory();

      releasePrepareProject({
        config: makeConfig(),
        options: { force: true },
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

      const result = releasePrepareProject({
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

      const result = releasePrepareProject({
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

      const result = releasePrepareProject({
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

// region | Helpers

/** Asserts that the run read the project's history exactly once, under the project tag prefix and `paths`. */
function expectOneHistoryRead(config: MonorepoReleaseConfig, paths: string[]): void {
  expect(mockReadReleaseHistory).toHaveBeenCalledTimes(1);
  expect(mockReadReleaseHistory).toHaveBeenCalledWith(config, { tagPrefixes: ['v'], paths });
}

/** Builds a monorepo config with two workspaces and a project block spanning both. */
function makeConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
  return {
    workspaces: [makeWorkspace({ dir: 'arrays' }), makeWorkspace({ dir: 'strings' })],
    workTypes: { feat: { header: 'Features' }, fix: { header: 'Bug fixes' } },
    changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
    project: { paths: ['packages/arrays/**', 'packages/strings/**'], tagPrefix: 'v' },
    ...overrides,
  };
}

/** Builds a workspace config under `packages/<dir>`. */
function makeWorkspace(overrides: Partial<WorkspaceConfig> & Pick<WorkspaceConfig, 'dir'>): WorkspaceConfig {
  const { dir } = overrides;
  return {
    name: `@test/${dir}`,
    tagPrefix: `${dir}-v`,
    workspacePath: `packages/${dir}`,
    isPublishable: true,
    packageFiles: [`packages/${dir}/package.json`],
    changelogPaths: [`packages/${dir}`],
    paths: [`packages/${dir}/**`],
    ...overrides,
  };
}

/** Returns the content that the staged writes intend for `path`, or undefined when no write targets it. */
function plannedContent(writes: readonly PlannedWrite[], path: string): string | undefined {
  return writes.find((write) => write.path === path)?.content;
}

/** Stubs a history above the `v0.9.0` baseline whose one feature commit calls for a minor bump. */
function stubDefaultHistory(overrides: ReleaseHistoryStub = {}): void {
  stubHistory({
    previousTag: 'v0.9.0',
    commits: [['#1 feat: ship project', 'abc123']],
    bump: 'minor',
    sections: UNRELEASED_SECTIONS,
    ...overrides,
  });
}

/** Stubs the history that `readReleaseHistory` returns. */
function stubHistory(stub: ReleaseHistoryStub): void {
  mockReadReleaseHistory.mockReturnValue(makeReleaseHistory(stub));
}

// endregion | Helpers
