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

import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import type { PlannedWrite } from '../releasePlan.ts';
import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import {
  ENTRY_VIOLATION,
  makeConfig,
  MALFORMED_BLOCK,
  NEW_ENTRY,
  prepareProjectStage,
  RELEASED_ENTRY,
  stubDefaultHistory,
  UNDECLARED_ENTRY_TYPE,
  UNRELEASED_SECTIONS,
} from '../test-utils/prepareReleaseTargetsProjectFixtures.ts';
import type { ChangelogEntry } from '../types.ts';

describe('prepareReleaseTargets for a project composite', () => {
  beforeEach(() => {
    applyPrepareReleaseTargetsProjectDefaults();
  });

  afterEach(() => {
    resetPrepareReleaseTargetsProjectMocks();
  });

  it("returns a structured skipped result when the window doesn't have any commits since the last project tag and --force is not set", () => {
    stubHistory({ previousTag: 'v0.9.0' });
    const config = makeConfig();
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = prepareProjectStage({
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

  it("skips a window whose commits don't call for a bump, reporting the history's counts and diagnostics", () => {
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

    const result = prepareProjectStage({
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

  it('falls back to patch when --force is set without any commits (no --bump)', () => {
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
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(result.commitCount).toBe(0);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.bumpOverride).toBeUndefined();
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it("releases at patch when --force is set on a window whose commits don't call for a bump", () => {
    stubHistory({
      previousTag: 'v0.9.0',
      commits: [['chore: update deps', 'abc123']],
      unparseableCommits: [['chore: update deps', 'abc123']],
    });
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
    expect(result.releaseType).toBe('patch');
    expect(result.newVersion).toBe('0.9.1');
    expect(result.commitCount).toBe(1);
    expect(result.parsedCommitCount).toBe(0);
    expect(result.unparseableCommits).toStrictEqual(makeStubbedCommits([['chore: update deps', 'abc123']]));
    expect(tags).toStrictEqual(['v0.9.1']);
  });

  it("skips when --bump=X alone is set on a window whose commits don't call for a bump (level chooser, not trigger)", () => {
    stubHistory({ previousTag: 'v0.9.0', commits: [['chore: update deps', 'abc123']] });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = prepareProjectStage({
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

    const result = prepareProjectStage({
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

    // The plan contains the root package.json at the new version; planning doesn't write any file.
    expect(plannedContent(writes, './package.json')).toContain('"version": "0.10.0"');
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    expectOneHistoryRead(config, ['packages/arrays/**', 'packages/strings/**']);
  });

  it("labels the unreleased window's sections with the new tag, ahead of the released entries", () => {
    stubDefaultHistory({ releasedEntries: [RELEASED_ENTRY] });

    prepareProjectStage({
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

    prepareProjectStage({
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

    prepareProjectStage({
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
    // Use a 1.x baseline so that the major bump is not collapsed by the pre-1.0 rule in `bumpVersion`.
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'root', version: '1.5.2' }));
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = prepareProjectStage({
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

  it('runs without any commits when --force is set with --bump', () => {
    stubHistory({ previousTag: 'v0.9.0' });
    const tags: string[] = [];
    const modifiedFiles: string[] = [];

    const result = prepareProjectStage({
      config: makeConfig(),
      options: { shouldForce: true, bumpOverride: 'patch' },
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

    const result = prepareProjectStage({
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

    prepareProjectStage({
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

    prepareProjectStage({
      config,
      options: { shouldIncludeReleaseNotes: true },
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

    prepareProjectStage({
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

    const result = prepareProjectStage({
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
});

// region | Helpers
/** Returns the content that the staged writes intend for `path`, or undefined when the staged writes don't target it. */
function plannedContent(writes: readonly PlannedWrite[], path: string): string | undefined {
  return writes.find((write) => write.path === path)?.content;
}
// endregion | Helpers
