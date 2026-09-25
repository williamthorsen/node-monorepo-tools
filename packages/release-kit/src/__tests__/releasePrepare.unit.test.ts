import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockHasPrettierConfig = vi.hoisted(() => vi.fn());
const mockPlanReleaseNotesPreviews = vi.hoisted(() => vi.fn());

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

// Stub the history reader and the changelog writers so that no test reads git history or touches the filesystem.
const mockReadReleaseHistory = vi.hoisted(() => vi.fn());
const mockMergeChangelogEntriesWithDisk = vi.hoisted(() => vi.fn());
const mockRenderChangelogMarkdown = vi.hoisted(() => vi.fn());
const mockRenderChangelogJson = vi.hoisted(() => vi.fn());

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

import type { ChangelogDiagnostics } from '../buildChangelogEntries.ts';
import { buildEmptyReleaseEntry } from '../buildEmptyReleaseEntry.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
import { releasePrepare, type ReleasePrepareOptions } from '../releasePrepare.ts';
import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import { makeReleaseHistory, type ReleaseHistoryStub } from '../test-utils/releaseHistories.ts';
import type { ChangelogEntry, ChangelogSection, ReleaseConfig, WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
};

const featureSection: ChangelogSection = {
  title: 'Features',
  audience: 'all',
  items: [{ description: 'Add feature' }],
};

const diagnostics: ChangelogDiagnostics = {
  malformedBlocks: [{ commitHash: 'aaa1111', commitSubject: 'Squash', reason: '`entries` is not a list' }],
  policyViolations: [
    { commitHash: 'bbb2222', commitSubject: 'Merge PR', type: 'drop', surface: 'entry', entryPosition: 1 },
  ],
  undeclaredEntryTypes: [{ commitHash: 'bbb2222', commitSubject: 'Merge PR', entryPosition: 2, type: 'chore' }],
  unroutedEntryScopes: [{ commitHash: 'bbb2222', commitSubject: 'Merge PR', entryPosition: 3, scope: 'other' }],
};

function makeConfig(overrides?: Partial<ReleaseConfig>): ReleaseConfig {
  return {
    tagPrefix: 'v',
    packageFiles: ['package.json'],
    changelogPaths: ['.'],
    workTypes,
    changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
    ...overrides,
  };
}

describe(releasePrepare, () => {
  beforeEach(() => {
    mockMergeChangelogEntriesWithDisk.mockImplementation((_filePath: string, entries: unknown[]) => entries);
    mockRenderChangelogMarkdown.mockReturnValue('# Changelog\n');
    mockRenderChangelogJson.mockReturnValue('[]\n');
    mockPlanReleaseNotesPreviews.mockReturnValue({ writes: [], warnings: [] });
    // Default `existsSync` to false so synthetic-write paths skip the read-existing-file
    // branch by default. Individual tests override per-call when they exercise prepend behavior.
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockHasPrettierConfig.mockReset();
    mockPlanReleaseNotesPreviews.mockReset();
    mockReadReleaseHistory.mockReset();
    mockMergeChangelogEntriesWithDisk.mockReset();
    mockRenderChangelogMarkdown.mockReset();
    mockRenderChangelogJson.mockReset();
    vi.restoreAllMocks();
  });

  it('returns a PrepareResult with a released workspace on success', () => {
    stubMinorRelease();

    const result = releasePrepare(makeConfig(), {});

    expect(result.tags).toStrictEqual(['v1.1.0']);
    expect(result.workspaces).toHaveLength(1);

    const workspace = result.workspaces[0];
    expect(workspace).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      tag: 'v1.1.0',
      commitCount: 1,
      parsedCommitCount: 1,
    });
    expect(workspace?.name).toBeUndefined();
    assert(workspace?.status === 'released', 'expected released');
    expect(workspace.bumpedFiles).toStrictEqual(['package.json']);
    expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);
    expect(workspace.bumpOverride).toBeUndefined();
  });

  it('reads the release history once, for the configured tagPrefix', () => {
    stubMinorRelease();
    const config = makeConfig({ tagPrefix: 'my-lib-v' });

    releasePrepare(config, {});

    expect(mockReadReleaseHistory).toHaveBeenCalledExactlyOnceWith(config, { tagPrefixes: ['my-lib-v'] });
  });

  it("reports the history's bump, parse count, and unparseable commits on the released result", () => {
    stubHistory({
      previousTag: 'v1.0.0',
      commits: [
        ['feat: add feature', 'abc123'],
        ['chore: update deps', 'def456'],
      ],
      bump: 'minor',
      parsedCommitCount: 1,
      unparseableCommits: [['chore: update deps', 'def456']],
      sections: [featureSection],
    });
    stubPackageVersion('1.0.0');

    const result = releasePrepare(makeConfig(), {});

    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      commitCount: 2,
      parsedCommitCount: 1,
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual(
      makeStubbedCommits([['chore: update deps', 'def456']]),
    );
  });

  it("renders the history's sections under the new tag, ahead of its released entries", () => {
    const releasedEntry: ChangelogEntry = {
      version: '1.0.0',
      date: '2023-12-01',
      sections: [{ title: 'Bug fixes', audience: 'all', items: [{ description: 'Fix bug' }] }],
    };
    stubHistory({
      previousTag: 'v1.0.0',
      commits: [['feat: add feature', 'abc123']],
      bump: 'minor',
      sections: [featureSection],
      releasedEntries: [releasedEntry],
    });
    stubPackageVersion('1.0.0');

    releasePrepare(makeConfig(), {});

    expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
      [{ version: '1.1.0', date: '2024-01-01', sections: [featureSection] }, releasedEntry],
      expect.anything(),
    );
  });

  describe('release decision', () => {
    it.each<{ label: string; stub: ReleaseHistoryStub; options: ReleasePrepareOptions; skipReason: string }>([
      {
        label: 'no commits exist and no flag is given',
        stub: { previousTag: 'v1.0.0' },
        options: {},
        skipReason: 'No commits since v1.0.0. Pass --force to release at patch. Skipping.',
      },
      {
        label: 'no commits exist and only --bump is given',
        stub: { previousTag: 'v1.0.0' },
        options: { bumpOverride: 'major' },
        skipReason: 'No commits since v1.0.0. Pass --force to release at patch. Skipping.',
      },
      {
        label: 'commits exist without a bump and only --bump is given',
        stub: { previousTag: 'v1.0.0', commits: [['chore: update deps', 'abc123']] },
        options: { bumpOverride: 'minor' },
        skipReason:
          'No bump-worthy commits since v1.0.0. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
      },
      {
        label: 'no previous release and no commits exist',
        stub: {},
        options: {},
        skipReason: 'No commits (no previous release found). Pass --force to release at patch. Skipping.',
      },
      {
        label: 'no previous release exists and no commit calls for a bump',
        stub: { commits: [['chore: update deps', 'abc123']] },
        options: {},
        skipReason:
          'No bump-worthy commits (no previous release found). Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
      },
    ])('skips and plans nothing when $label', ({ stub, options, skipReason }) => {
      stubHistory(stub);
      stubPackageVersion('1.0.0');

      const result = releasePrepare(makeConfig(), options);

      expect(result.workspaces).toHaveLength(1);
      expect(result.workspaces[0]).toMatchObject({ status: 'skipped', skipReason });
      expect(result.workspaces[0]?.previousTag).toBe(stub.previousTag);
      expect(result.tags).toStrictEqual([]);
      expect(result.writes).toStrictEqual([]);
      expect(mockReadReleaseHistory).toHaveBeenCalledExactlyOnceWith(expect.anything(), { tagPrefixes: ['v'] });
    });

    it("skips commits that call for no bump, reporting the unparseable commits and the history's diagnostics", () => {
      stubHistory({
        previousTag: 'v1.0.0',
        commits: [
          ['chore: update deps', 'abc123'],
          ['Merge PR', 'bbb2222'],
        ],
        unparseableCommits: [['chore: update deps', 'abc123']],
        diagnostics,
      });
      stubPackageVersion('1.0.0');

      const result = releasePrepare(makeConfig(), {});

      expect(result.workspaces[0]).toStrictEqual({
        status: 'skipped',
        previousTag: 'v1.0.0',
        commitCount: 2,
        parsedCommitCount: 0,
        skipReason:
          'No bump-worthy commits since v1.0.0. Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
        unparseableCommits: makeStubbedCommits([['chore: update deps', 'abc123']]),
        ...diagnostics,
      });
    });

    it('releases at patch under bare --force when commits exist without a bump', () => {
      stubHistory({
        previousTag: 'v1.0.0',
        commits: [['chore: update deps', 'abc123']],
        unparseableCommits: [['chore: update deps', 'abc123']],
      });
      stubPackageVersion('1.0.0');

      const result = releasePrepare(makeConfig(), { force: true });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      expect(result.workspaces[0]).toMatchObject({
        status: 'released',
        releaseType: 'patch',
        commitCount: 1,
        parsedCommitCount: 0,
        unparseableCommits: makeStubbedCommits([['chore: update deps', 'abc123']]),
      });
    });

    it('releases at the --bump level over the natural bump, recording the override', () => {
      stubMinorRelease();

      const result = releasePrepare(makeConfig(), { bumpOverride: 'patch' });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      expect(result.workspaces[0]).toMatchObject({
        status: 'released',
        releaseType: 'patch',
        bumpOverride: 'patch',
        newVersion: '1.0.1',
        tag: 'v1.0.1',
        parsedCommitCount: 1,
      });
    });
  });

  it('renders the format command over package files and changelog paths', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      packageFiles: ['package.json', 'packages/core/package.json'],
      changelogPaths: ['.', 'packages/core'],
    });
    stubMinorRelease();

    const result = releasePrepare(config, {});

    expect(result.formatCommand).toStrictEqual({
      command: 'npx prettier --write package.json packages/core/package.json CHANGELOG.md packages/core/CHANGELOG.md',
      files: ['package.json', 'packages/core/package.json', 'CHANGELOG.md', 'packages/core/CHANGELOG.md'],
    });
  });

  it('does not run the format command, leaving that to the caller that applies the plan', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      packageFiles: ['package.json'],
      changelogPaths: ['.'],
    });
    stubMinorRelease();

    releasePrepare(config, {});

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('defaults to prettier when no formatCommand is set and prettier config exists', () => {
    stubMinorRelease();
    mockHasPrettierConfig.mockReturnValue(true);

    const result = releasePrepare(makeConfig(), {});

    expect(result.formatCommand).toMatchObject({ command: 'npx prettier --write package.json CHANGELOG.md' });
  });

  it('skips formatting when no formatCommand is set and no prettier config exists', () => {
    stubMinorRelease();
    mockHasPrettierConfig.mockReturnValue(false);

    const result = releasePrepare(makeConfig(), {});

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result.formatCommand).toBeUndefined();
  });

  it('constructs tags using the configured tagPrefix', () => {
    stubHistory({ previousTag: 'my-lib-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    stubPackageVersion('1.0.0');

    const result = releasePrepare(makeConfig({ tagPrefix: 'my-lib-v' }), {});

    expect(result.tags).toStrictEqual(['my-lib-v1.1.0']);
    expect(result.workspaces[0]).toMatchObject({
      tag: 'my-lib-v1.1.0',
    });
  });

  it('populates tags on the plan', () => {
    stubMinorRelease();

    const result = releasePrepare(makeConfig(), {});

    expect(result.tags).toStrictEqual(['v1.1.0']);
  });

  it('writes the explicit --set-version value, bypassing the release decision', () => {
    stubHistory({ previousTag: 'v0.5.0', commits: [['chore: unrelated change', 'abc123']] });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = releasePrepare(makeConfig(), { setVersion: '1.0.0' });

    expect(result.tags).toStrictEqual(['v1.0.0']);
    expect(result.workspaces).toHaveLength(1);
    const workspace = result.workspaces[0];
    expect(workspace).toMatchObject({
      status: 'released',
      newVersion: '1.0.0',
      currentVersion: '0.5.0',
      tag: 'v1.0.0',
      setVersion: '1.0.0',
    });
    assert(workspace?.status === 'released', 'expected released');
    expect(workspace.releaseType).toBeUndefined();
    expect(plannedContent(result, 'package.json')).toContain('"version": "1.0.0"');
  });

  it("attaches the history's diagnostics under --set-version, leaving the parse results off", () => {
    stubHistory({
      previousTag: 'v0.5.0',
      commits: [['chore: unrelated change', 'abc123']],
      unparseableCommits: [['chore: unrelated change', 'abc123']],
      diagnostics,
    });
    stubPackageVersion('0.5.0');

    const result = releasePrepare(makeConfig(), { setVersion: '1.0.0' });

    const workspace = result.workspaces[0];
    assert(workspace?.status === 'released', 'expected released');
    expect(workspace).toMatchObject(diagnostics);
    expect(workspace.releaseType).toBeUndefined();
    expect(workspace.parsedCommitCount).toBeUndefined();
    expect(workspace.unparseableCommits).toBeUndefined();
    expect(workspace.bumpOverride).toBeUndefined();
  });

  it('writes a synthetic empty-range changelog when --set-version is used with zero commits', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = releasePrepare(makeConfig(), { setVersion: '1.0.0' });

    const workspace = result.workspaces[0];
    assert(workspace?.status === 'released', 'expected released');
    expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);

    // The empty-range branch builds the synthetic entry and routes it through the markdown
    // renderer; assert on the entries the renderer received.
    expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          version: '1.0.0',
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
    expect(mockReadReleaseHistory).toHaveBeenCalledExactlyOnceWith(expect.anything(), { tagPrefixes: ['v'] });
  });

  it('throws when --set-version is not greater than the current version', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    expect(() => releasePrepare(makeConfig(), { setVersion: '0.3.0' })).toThrow(
      '--set-version 0.3.0 is not greater than current version 0.5.0',
    );
  });

  it('throws when --set-version equals the current version', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    expect(() => releasePrepare(makeConfig(), { setVersion: '0.5.0' })).toThrow(
      '--set-version 0.5.0 is not greater than current version 0.5.0',
    );
  });

  it('fails naming the package file when --set-version meets an unreadable package file', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => releasePrepare(makeConfig(), { setVersion: '1.0.0' })).toThrow(
      'Failed to read package.json: EACCES: permission denied',
    );
  });

  it('calls planReleaseNotesPreviews with the relative root path when --with-release-notes is set and changelogJson is enabled', () => {
    stubMinorRelease();

    releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
      withReleaseNotes: true,
    });

    expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledTimes(1);
    expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '.',
        tag: 'v1.1.0',
        sectionOrder: expect.any(Array),
        entries: expect.any(Array),
      }),
    );
  });

  it('records a warning and skips preview generation when --with-release-notes is set but changelogJson is disabled', () => {
    stubMinorRelease();
    using silent = silenceConsole(['warn']);

    const plan = releasePrepare(makeConfig(), { withReleaseNotes: true });

    expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
    expect(plan.warnings).toStrictEqual([
      '--with-release-notes requires changelogJson.enabled; skipping preview generation',
    ]);
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('does not call planReleaseNotesPreviews when --with-release-notes is not set', () => {
    stubMinorRelease();

    releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {});

    expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
  });

  it('carries the planned preview files into the plan', () => {
    stubMinorRelease();
    mockPlanReleaseNotesPreviews.mockReturnValue({
      writes: [{ path: 'docs/RELEASE_NOTES.v1.1.0.md', content: '# Notes\n' }],
      warnings: [],
    });

    const plan = releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
      withReleaseNotes: true,
    });

    expect(plannedContent(plan, 'docs/RELEASE_NOTES.v1.1.0.md')).toBe('# Notes\n');
    expect(plan.workspaces[0]).toMatchObject({ previewFiles: ['docs/RELEASE_NOTES.v1.1.0.md'] });
  });

  describe('window that yields no item (--force / --set-version)', () => {
    /** Stubs a history whose tag has no commits above it, over a package at 1.0.0. */
    function stubEmptyRange(): void {
      stubHistory({ previousTag: 'v1.0.0' });
      stubPackageVersion('1.0.0');
    }

    it('writes a synthetic Notes / Forced version bump entry when --force is used with no commits', () => {
      stubEmptyRange();

      const result = releasePrepare(makeConfig(), { force: true });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      const workspace = result.workspaces[0];
      assert(workspace?.status === 'released', 'expected released');
      expect(workspace.releaseType).toBe('patch');
      expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);

      // The empty-range branch builds a synthetic entry and routes it through the markdown
      // renderer; assert on the entries the renderer received rather than the literal file
      // bytes (the writer is mocked).
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

    it('releases at the --bump level under --force --bump with no commits', () => {
      stubEmptyRange();

      const result = releasePrepare(makeConfig(), { force: true, bumpOverride: 'minor' });

      expect(result.tags).toStrictEqual(['v1.1.0']);
      expect(result.workspaces[0]).toMatchObject({
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
      'writes the synthetic entry under %s when the window has commits but yields no item',
      (_label, options, version) => {
        stubHistory({
          previousTag: 'v1.0.0',
          commits: [
            ['fmt: reformat', 'abc123'],
            ['update readme', 'def456'],
          ],
        });
        stubPackageVersion('1.0.0');

        releasePrepare(makeConfig(), options);

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

      releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
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

      const result = releasePrepare(
        makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        {
          force: true,
        },
      );

      expect(result.tags).toStrictEqual(['v1.0.1']);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
      const workspace = result.workspaces[0];
      assert(workspace?.status === 'released', 'expected released');
      expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);
    });

    it('appends synthetic CHANGELOG.md and changelog.json paths to formatCommand.files', () => {
      stubEmptyRange();
      const config = makeConfig({
        formatCommand: 'npx prettier --write',
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });

      const result = releasePrepare(config, { force: true });

      expect(result.formatCommand?.files).toContain('CHANGELOG.md');
      expect(result.formatCommand?.files).toContain('./.meta/changelog.json');
    });
  });

  it('plans the --set-version tag without writing any file', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = releasePrepare(makeConfig(), { setVersion: '1.0.0' });

    expect(result.tags).toStrictEqual(['v1.0.0']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  describe('diagnostics', () => {
    it('omits every diagnostic when the history reports none', () => {
      stubMinorRelease();

      const result = releasePrepare(makeConfig(), {});

      const workspace = result.workspaces[0];
      expect(workspace?.malformedBlocks).toBeUndefined();
      expect(workspace?.policyViolations).toBeUndefined();
      expect(workspace?.undeclaredEntryTypes).toBeUndefined();
    });

    it("attaches the history's diagnostics to the released result", () => {
      stubHistory({ previousTag: 'v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor', diagnostics });
      stubPackageVersion('1.0.0');

      const result = releasePrepare(makeConfig(), {});

      expect(result.workspaces[0]).toMatchObject({ status: 'released', ...diagnostics });
    });
  });

  describe('changelogJson.enabled gating', () => {
    it('plans no changelog.json write when changelogJson.enabled is false', () => {
      stubMinorRelease();

      releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false } }), {});

      expect(mockRenderChangelogJson).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
    });

    it('plans a changelog.json write when changelogJson.enabled is true', () => {
      stubMinorRelease();

      const plan = releasePrepare(
        makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        {},
      );

      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
      expect(plan.writes.map((write) => write.path)).toContain('./.meta/changelog.json');
    });
  });
});

// region | Helpers

/** Returns the content that the plan intends to write to `path`, or undefined when the plan does not write it. */
function plannedContent(
  plan: { writes: readonly { path: string; content: string }[] },
  path: string,
): string | undefined {
  return plan.writes.find((write) => write.path === path)?.content;
}

/** Stubs the history that `readReleaseHistory` returns. */
function stubHistory(stub: ReleaseHistoryStub): void {
  mockReadReleaseHistory.mockReturnValue(makeReleaseHistory(stub));
}

/** Stubs a history with one commit above v1.0.0 that calls for a minor bump, over a package at 1.0.0. */
function stubMinorRelease(): void {
  stubHistory({
    previousTag: 'v1.0.0',
    commits: [['feat: add feature', 'abc123']],
    bump: 'minor',
    sections: [featureSection],
  });
  stubPackageVersion('1.0.0');
}

/** Stubs every package file's content as a manifest at `version`. */
function stubPackageVersion(version: string): void {
  mockReadFileSync.mockReturnValue(JSON.stringify({ version }));
}

// endregion | Helpers
