import { silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
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
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import { makeStubbedCommits } from '../test-utils/commitStubs.ts';
import { selectPackageResults } from '../test-utils/prepareResults.ts';
import type { ReleaseHistoryStub } from '../test-utils/releaseHistories.ts';
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

  it('returns a PrepareResult with a released workspace on success', () => {
    stubMinorRelease();

    const result = prepareSinglePackage(makeConfig(), {});

    expect(result.tags).toStrictEqual(['v1.1.0']);
    expect(selectPackageResults(result)).toHaveLength(1);

    const workspace = selectPackageResults(result)[0];
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

    prepareSinglePackage(config, {});

    expect(mockReadReleaseHistory).toHaveBeenCalledExactlyOnceWith(config.settings, { tagPrefixes: ['my-lib-v'] });
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

    const result = prepareSinglePackage(makeConfig(), {});

    expect(selectPackageResults(result)[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      commitCount: 2,
      parsedCommitCount: 1,
    });
    expect(selectPackageResults(result)[0]?.unparseableCommits).toStrictEqual(
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

    prepareSinglePackage(makeConfig(), {});

    expect(mockRenderChangelogMarkdown).toHaveBeenCalledWith(
      [{ version: '1.1.0', date: '2024-01-01', sections: [featureSection] }, releasedEntry],
      expect.anything(),
    );
  });

  describe('release decision', () => {
    it.each<{ label: string; stub: ReleaseHistoryStub; options: SinglePackageOptions; skipReason: string }>([
      {
        label: "the window doesn't have any commits and the options don't set a flag",
        stub: { previousTag: 'v1.0.0' },
        options: {},
        skipReason: 'No commits since v1.0.0. Pass --force to release at patch. Skipping.',
      },
      {
        label: "the window doesn't have any commits and only --bump is given",
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
        label: "the history doesn't have a previous release or any commits",
        stub: {},
        options: {},
        skipReason: 'No commits (no previous release found). Pass --force to release at patch. Skipping.',
      },
      {
        label: "the history doesn't have a previous release and its commits don't call for a bump",
        stub: { commits: [['chore: update deps', 'abc123']] },
        options: {},
        skipReason:
          'No bump-worthy commits (no previous release found). Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
      },
    ])('skips and plans nothing when $label', ({ stub, options, skipReason }) => {
      stubHistory(stub);
      stubPackageVersion('1.0.0');

      const result = prepareSinglePackage(makeConfig(), options);

      expect(selectPackageResults(result)).toHaveLength(1);
      expect(selectPackageResults(result)[0]).toMatchObject({ status: 'skipped', skipReason });
      expect(selectPackageResults(result)[0]?.previousTag).toBe(stub.previousTag);
      expect(result.tags).toStrictEqual([]);
      expect(result.writes).toStrictEqual([]);
      expect(mockReadReleaseHistory).toHaveBeenCalledExactlyOnceWith(expect.anything(), { tagPrefixes: ['v'] });
    });

    it("skips commits that don't call for a bump, reporting the unparseable commits and the history's diagnostics", () => {
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

      const result = prepareSinglePackage(makeConfig(), {});

      expect(selectPackageResults(result)[0]).toStrictEqual({
        targetId: '.',
        kind: 'package',
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

      const result = prepareSinglePackage(makeConfig(), { force: true });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      expect(selectPackageResults(result)[0]).toMatchObject({
        status: 'released',
        releaseType: 'patch',
        commitCount: 1,
        parsedCommitCount: 0,
        unparseableCommits: makeStubbedCommits([['chore: update deps', 'abc123']]),
      });
    });

    it('releases at the --bump level over the natural bump, recording the override', () => {
      stubMinorRelease();

      const result = prepareSinglePackage(makeConfig(), { bumpOverride: 'patch' });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      expect(selectPackageResults(result)[0]).toMatchObject({
        status: 'released',
        releaseType: 'patch',
        bumpOverride: 'patch',
        newVersion: '1.0.1',
        tag: 'v1.0.1',
        parsedCommitCount: 1,
      });
    });
  });

  it('renders the format command over the version files and the changelog', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      versionFiles: ['package.json', 'packages/core/package.json'],
    });
    stubMinorRelease();

    const result = prepareSinglePackage(config, {});

    expect(result.formatCommand).toStrictEqual({
      command: 'npx prettier --write package.json packages/core/package.json CHANGELOG.md',
      files: ['package.json', 'packages/core/package.json', 'CHANGELOG.md'],
    });
  });

  it('does not run the format command, leaving that to the caller that applies the plan', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
    });
    stubMinorRelease();

    prepareSinglePackage(config, {});

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("defaults to prettier when the config doesn't set formatCommand and a prettier config exists", () => {
    stubMinorRelease();
    mockHasPrettierConfig.mockReturnValue(true);

    const result = prepareSinglePackage(makeConfig(), {});

    expect(result.formatCommand).toMatchObject({ command: 'npx prettier --write package.json CHANGELOG.md' });
  });

  it("skips formatting when the config doesn't set formatCommand and the repo doesn't have a prettier config", () => {
    stubMinorRelease();
    mockHasPrettierConfig.mockReturnValue(false);

    const result = prepareSinglePackage(makeConfig(), {});

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result.formatCommand).toBeUndefined();
  });

  it('constructs tags using the configured tagPrefix', () => {
    stubHistory({ previousTag: 'my-lib-v1.0.0', commits: [['feat: add feature', 'abc123']], bump: 'minor' });
    stubPackageVersion('1.0.0');

    const result = prepareSinglePackage(makeConfig({ tagPrefix: 'my-lib-v' }), {});

    expect(result.tags).toStrictEqual(['my-lib-v1.1.0']);
    expect(selectPackageResults(result)[0]).toMatchObject({
      tag: 'my-lib-v1.1.0',
    });
  });

  it('populates tags on the plan', () => {
    stubMinorRelease();

    const result = prepareSinglePackage(makeConfig(), {});

    expect(result.tags).toStrictEqual(['v1.1.0']);
  });

  it('writes the explicit --set-version value, bypassing the release decision', () => {
    stubHistory({ previousTag: 'v0.5.0', commits: [['chore: unrelated change', 'abc123']] });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = prepareSinglePackage(makeConfig(), { setVersion: '1.0.0' });

    expect(result.tags).toStrictEqual(['v1.0.0']);
    expect(selectPackageResults(result)).toHaveLength(1);
    const workspace = selectPackageResults(result)[0];
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

    const result = prepareSinglePackage(makeConfig(), { setVersion: '1.0.0' });

    const workspace = selectPackageResults(result)[0];
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

    const result = prepareSinglePackage(makeConfig(), { setVersion: '1.0.0' });

    const workspace = selectPackageResults(result)[0];
    assert(workspace?.status === 'released', 'expected released');
    expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);

    // The empty-range branch builds the synthetic entry and passes it to the markdown
    // renderer; assert on the entries that the renderer received.
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

    expect(() => prepareSinglePackage(makeConfig(), { setVersion: '0.3.0' })).toThrow(
      '--set-version 0.3.0 is not greater than current version 0.5.0',
    );
  });

  it('throws when --set-version equals the current version', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    expect(() => prepareSinglePackage(makeConfig(), { setVersion: '0.5.0' })).toThrow(
      '--set-version 0.5.0 is not greater than current version 0.5.0',
    );
  });

  it('fails naming the package file when --set-version meets an unreadable package file', () => {
    stubHistory({ previousTag: 'v0.5.0' });
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => prepareSinglePackage(makeConfig(), { setVersion: '1.0.0' })).toThrow(
      'Failed to read package.json: EACCES: permission denied',
    );
  });

  it('calls planReleaseNotesPreviews with the relative root path when --with-release-notes is set and changelogJson is enabled', () => {
    stubMinorRelease();

    prepareSinglePackage(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
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

    const plan = prepareSinglePackage(makeConfig(), { withReleaseNotes: true });

    expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
    expect(plan.warnings).toStrictEqual([
      '--with-release-notes requires changelogJson.enabled; skipping preview generation',
    ]);
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('does not call planReleaseNotesPreviews when --with-release-notes is not set', () => {
    stubMinorRelease();

    prepareSinglePackage(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {});

    expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
  });

  it('includes the planned preview files in the plan', () => {
    stubMinorRelease();
    mockPlanReleaseNotesPreviews.mockReturnValue({
      writes: [{ path: 'docs/RELEASE_NOTES.v1.1.0.md', content: '# Notes\n' }],
      warnings: [],
    });

    const plan = prepareSinglePackage(
      makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
      {
        withReleaseNotes: true,
      },
    );

    expect(plannedContent(plan, 'docs/RELEASE_NOTES.v1.1.0.md')).toBe('# Notes\n');
    expect(selectPackageResults(plan)[0]).toMatchObject({ previewFiles: ['docs/RELEASE_NOTES.v1.1.0.md'] });
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

// endregion | Helpers
