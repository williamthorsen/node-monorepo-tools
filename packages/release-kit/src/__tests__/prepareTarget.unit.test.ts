import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockReadReleaseHistory = vi.hoisted(() => vi.fn());
const mockFindUntaggedBaseline = vi.hoisted(() => vi.fn());
const mockMergeChangelogEntriesWithDisk = vi.hoisted(() => vi.fn());
const mockPlanReleaseNotesPreviews = vi.hoisted(() => vi.fn());
const mockListArchiveFiles = vi.hoisted(() =>
  vi.fn<(changelogDir: string) => Array<{ majorVersion: number; path: string }>>(),
);

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock(import('../buildChangelogEntries.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readReleaseHistory: mockReadReleaseHistory,
}));

vi.mock(import('../assertTaggedBaseline.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  findUntaggedBaseline: mockFindUntaggedBaseline,
}));

vi.mock(import('../changelogJsonFile.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  renderChangelogJson: (entries: unknown[]): string => `json:${entries.length}`,
  mergeChangelogEntriesWithDisk: mockMergeChangelogEntriesWithDisk,
}));

vi.mock(import('../changelogArchive.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  listArchiveFiles: mockListArchiveFiles,
}));

vi.mock(import('../renderChangelogMarkdown.ts'), () => ({
  // Archives the oldest entry under major 0 whenever `keptVersionCount` is set.
  renderChangelogFiles: (entries: unknown[], options?: { keptVersionCount?: number }) => ({
    main: `md:${entries.length}`,
    archives: options?.keptVersionCount === undefined ? [] : [{ major: 0, content: 'md:archive' }],
  }),
}));

vi.mock(import('../planReleaseNotesPreviews.ts'), () => ({
  planReleaseNotesPreviews: mockPlanReleaseNotesPreviews,
}));

import type { ReleaseHistory } from '../buildChangelogEntries.ts';
import type { OverrideContext } from '../changelogOverrides.ts';
import { DEFAULT_CHANGELOG_JSON_CONFIG } from '../defaults.ts';
import {
  buildSkippedTargetResult,
  decideTargetRelease,
  planTargetRelease,
  type PlanTargetReleaseArgs,
  readTargetHistory,
  type TargetPrepareSettings,
} from '../prepareTarget.ts';
import { makeReleaseHistory } from '../test-utils/releaseHistories.ts';
import type { ChangelogEntry, CompositeTarget, PackageTarget } from '../types.ts';

const SETTINGS: TargetPrepareSettings = { changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } };

const ROOT: PackageTarget = {
  id: '.',
  kind: 'package',
  isWorkspace: false,
  tagPrefix: 'v',
  versionFiles: ['package.json'],
  changelogDir: '.',
  packagePath: '.',
  isPublishable: true,
};

const CORE: PackageTarget = {
  id: 'core',
  kind: 'package',
  packageName: '@scope/core',
  tagPrefix: 'core-v',
  legacyIdentities: [{ name: '@scope/old-core', tagPrefix: 'old-core-v' }],
  versionFiles: ['packages/core/package.json'],
  changelogDir: 'packages/core',
  paths: ['packages/core/**'],
  isPublishable: true,
  packagePath: 'packages/core',
  isWorkspace: true,
};

const PROJECT: CompositeTarget = {
  id: '',
  kind: 'composite',
  members: ['core'],
  tagPrefix: 'v',
  versionFiles: ['./package.json'],
  changelogDir: '.',
  paths: ['packages/core/**'],
  isPublishable: false,
};

const FEATURE_HISTORY = {
  previousTag: 'core-v1.0.0',
  commits: [['feat: Ship it', 'abc1234']] as const,
  bump: 'minor' as const,
  unparseableCommits: [['wip', 'fff0000']] as const,
  sections: [{ title: 'Features', audience: 'all' as const, items: [{ description: 'Ship it', hash: 'abc1234' }] }],
};

describe(readTargetHistory, () => {
  beforeEach(() => {
    mockReadReleaseHistory.mockReturnValue(makeReleaseHistory({ previousTag: 'core-v1.0.0' }));
    mockFindUntaggedBaseline.mockReturnValue(undefined);
  });

  afterEach(() => {
    mockReadReleaseHistory.mockReset();
    mockFindUntaggedBaseline.mockReset();
  });

  it('reads a workspace under its current and legacy prefixes, its paths, and its routing scope', () => {
    readTargetHistory(CORE, SETTINGS);

    expect(mockReadReleaseHistory).toHaveBeenCalledWith(SETTINGS, {
      tagPrefixes: ['core-v', 'old-core-v'],
      paths: ['packages/core/**'],
      scope: 'core',
    });
  });

  it('routes a renamed workspace by its target name, not its directory', () => {
    readTargetHistory({ ...CORE, id: 'kernel' }, SETTINGS);

    expect(mockReadReleaseHistory).toHaveBeenCalledWith(SETTINGS, expect.objectContaining({ scope: 'kernel' }));
  });

  it('reads the single-package root without paths or routing', () => {
    readTargetHistory(ROOT, SETTINGS);

    expect(mockReadReleaseHistory).toHaveBeenCalledWith(SETTINGS, { tagPrefixes: ['v'] });
  });

  it('reads a composite under its paths without routing', () => {
    readTargetHistory(PROJECT, SETTINGS);

    expect(mockReadReleaseHistory).toHaveBeenCalledWith(SETTINGS, { tagPrefixes: ['v'], paths: ['packages/core/**'] });
  });

  it.each([
    { target: ROOT, label: 'package' },
    { target: CORE, label: "workspace 'core'" },
    { target: PROJECT, label: 'project' },
  ])('checks the baseline of $label from its version files and changelog dir', ({ target, label }) => {
    readTargetHistory(target, SETTINGS);

    expect(mockFindUntaggedBaseline).toHaveBeenCalledWith(
      {
        label,
        packageFiles: target.versionFiles,
        changelogPaths: [target.changelogDir],
        tagPrefixes: expect.any(Array),
        previousTag: 'core-v1.0.0',
      },
      SETTINGS,
    );
  });

  it('returns the untagged baseline that it finds', () => {
    const untagged = { label: 'package', version: '1.0.0', tag: 'v1.0.0' };
    mockFindUntaggedBaseline.mockReturnValue(untagged);

    expect(readTargetHistory(ROOT, SETTINGS).untaggedBaseline).toBe(untagged);
  });
});

describe(decideTargetRelease, () => {
  const noForce = { shouldForce: false, bumpOverride: undefined, setVersion: undefined };

  it('names a workspace in its skip reason', () => {
    const decision = decideTargetRelease(CORE, makeReleaseHistory({ previousTag: 'core-v1.0.0' }), noForce);

    expect(decision).toStrictEqual({
      outcome: 'skip',
      skipReason: 'No commits for core since core-v1.0.0. Pass --force to release at patch. Skipping.',
    });
  });

  it.each([ROOT, PROJECT])('leaves the $kind target unnamed in its skip reason', (target) => {
    const history = makeReleaseHistory({ commits: [['chore: tidy', 'abc1234']] });

    const decision = decideTargetRelease(target, history, noForce);

    expect(decision).toStrictEqual({
      outcome: 'skip',
      skipReason:
        'No bump-worthy commits (no previous release found). Pass --force to release at patch (or --force --bump=X for a different level). Skipping.',
    });
  });

  it('releases at the bump override under --force', () => {
    const decision = decideTargetRelease(CORE, makeReleaseHistory(), {
      shouldForce: true,
      bumpOverride: 'major',
      setVersion: undefined,
    });

    expect(decision).toStrictEqual({
      outcome: 'release',
      releaseType: 'major',
      bumpOverride: 'major',
      setVersion: undefined,
    });
  });

  it('releases at an explicit version without deciding a level', () => {
    const decision = decideTargetRelease(CORE, makeReleaseHistory(), {
      shouldForce: false,
      bumpOverride: 'minor',
      setVersion: '3.0.0',
    });

    expect(decision).toStrictEqual({
      outcome: 'release',
      releaseType: undefined,
      bumpOverride: undefined,
      setVersion: '3.0.0',
    });
  });
});

describe(planTargetRelease, () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
    mockListArchiveFiles.mockReturnValue([]);
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'x', version: '1.0.0' }));
    mockMergeChangelogEntriesWithDisk.mockImplementation((_path: string, entries: ChangelogEntry[]) => entries);
    mockPlanReleaseNotesPreviews.mockReturnValue({
      writes: [{ path: 'docs/RELEASE_NOTES.md', content: 'notes' }],
      warnings: ['README.md not found'],
    });
  });

  afterEach(() => {
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockMergeChangelogEntriesWithDisk.mockReset();
    mockPlanReleaseNotesPreviews.mockReset();
    mockListArchiveFiles.mockReset();
  });

  it('plans a direct package release: bump, changelogs, tag, and result', () => {
    const planned = planTargetRelease(makeArgs({ target: CORE }));

    expect(planned.tag).toBe('core-v1.1.0');
    expect(planned.writes.map((write) => write.path)).toStrictEqual([
      'packages/core/package.json',
      'packages/core/.meta/changelog.json',
      'packages/core/CHANGELOG.md',
    ]);
    expect(planned.modifiedFiles).toStrictEqual([
      'packages/core/package.json',
      'packages/core/CHANGELOG.md',
      'packages/core/.meta/changelog.json',
    ]);
    expect(planned.warnings).toStrictEqual([]);
    expect(planned.result).toStrictEqual({
      targetId: 'core',
      status: 'released',
      kind: 'package',
      name: 'core',
      previousTag: 'core-v1.0.0',
      commitCount: 1,
      parsedCommitCount: 1,
      unparseableCommits: [expect.objectContaining({ subject: 'wip' })],
      releaseType: 'minor',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      tag: 'core-v1.1.0',
      bumpedFiles: ['packages/core/package.json'],
      changelogFiles: ['packages/core/CHANGELOG.md'],
      commits: [expect.objectContaining({ subject: 'feat: Ship it' })],
    });
  });

  it('writes the archive files beside CHANGELOG.md under keptVersionCount, leaving the changelog JSON unchanged', () => {
    const settings = { ...SETTINGS, changelogMarkdown: { keptVersionCount: 1 } };

    const planned = planTargetRelease(makeArgs({ settings }));
    const unbounded = planTargetRelease(makeArgs());

    expect(planned.writes).toContainEqual({ path: 'packages/core/changelogs/CHANGELOG-v0.md', content: 'md:archive' });
    expect(planned.result).toMatchObject({
      changelogFiles: ['packages/core/CHANGELOG.md', 'packages/core/changelogs/CHANGELOG-v0.md'],
    });
    expect(planned.modifiedFiles).toContain('packages/core/changelogs/CHANGELOG-v0.md');
    const jsonWrite = (writes: Array<{ path: string }>) =>
      writes.find((write) => write.path.endsWith('changelog.json'));
    expect(jsonWrite(planned.writes)).toStrictEqual(jsonWrite(unbounded.writes));
  });

  it('removes the existing archive files that the render does not produce', () => {
    mockListArchiveFiles.mockReturnValue([
      { majorVersion: 1, path: 'packages/core/changelogs/CHANGELOG-v1.md' },
      { majorVersion: 0, path: 'packages/core/changelogs/CHANGELOG-v0.md' },
    ]);
    const settings = { ...SETTINGS, changelogMarkdown: { keptVersionCount: 1 } };

    const planned = planTargetRelease(makeArgs({ settings }));

    expect(planned.removals).toStrictEqual(['packages/core/changelogs/CHANGELOG-v1.md']);
    expect(planned.result).toMatchObject({ removedChangelogFiles: ['packages/core/changelogs/CHANGELOG-v1.md'] });
    expect(planned.modifiedFiles).not.toContain('packages/core/changelogs/CHANGELOG-v1.md');
  });

  it('names a renamed workspace by its target name', () => {
    const { result } = planTargetRelease(makeArgs({ target: { ...CORE, id: 'kernel' } }));

    expect(result).toMatchObject({ targetId: 'kernel', name: 'kernel' });
  });

  it('omits the name of the single-package root', () => {
    const { result } = planTargetRelease(makeArgs({ target: ROOT }));

    expect(result).not.toHaveProperty('name');
    expect(result.tag).toBe('v1.1.0');
  });

  it('records the bump override of a direct release', () => {
    const { result } = planTargetRelease(
      makeArgs({
        decision: { outcome: 'release', releaseType: 'major', bumpOverride: 'major', setVersion: undefined },
      }),
    );

    expect(result.bumpOverride).toBe('major');
  });

  it('applies --set-version without a release type or parse counts', () => {
    const { result, tag } = planTargetRelease(
      makeArgs({
        decision: { outcome: 'release', releaseType: undefined, bumpOverride: undefined, setVersion: '4.0.0' },
      }),
    );

    expect(tag).toBe('core-v4.0.0');
    expect(result).toMatchObject({ versionOverride: '4.0.0', newVersion: '4.0.0' });
    expect(result).not.toHaveProperty('releaseType');
    expect(result).not.toHaveProperty('parsedCommitCount');
    expect(result).not.toHaveProperty('unparseableCommits');
  });

  it('plans a propagation-only release from one synthetic dependency entry', () => {
    const propagatedFrom = [{ packageName: '@scope/base', newVersion: '2.0.0' }];

    const planned = planTargetRelease(
      makeArgs({
        decision: undefined,
        release: { releaseType: 'patch', propagatedFrom },
        history: makeReleaseHistory({ previousTag: 'core-v1.0.0', commits: [['chore: tidy', 'abc1234']] }),
      }),
    );

    expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledWith('packages/core/.meta/changelog.json', [
      {
        version: '1.0.1',
        date: '2024-02-02',
        sections: [
          { title: 'Dependencies', audience: 'dev', items: [{ description: 'Bumped `@scope/base` to 2.0.0' }] },
        ],
      },
    ]);
    expect(planned.result).toMatchObject({
      propagatedOnly: true,
      propagatedFrom,
      releaseType: 'patch',
      commitCount: 1,
    });
    expect(planned.result).not.toHaveProperty('parsedCommitCount');
  });

  it('plans a composite release with the composite result fields', () => {
    const { result, modifiedFiles } = planTargetRelease(
      makeArgs({ target: PROJECT, history: makeReleaseHistory({ ...FEATURE_HISTORY, previousTag: 'v1.0.0' }) }),
    );

    expect(modifiedFiles).toStrictEqual(['./package.json', 'CHANGELOG.md', '.meta/changelog.json']);
    expect(result).toStrictEqual({
      targetId: '',
      status: 'released',
      kind: 'composite',
      previousTag: 'v1.0.0',
      commitCount: 1,
      parsedCommitCount: 1,
      unparseableCommits: [expect.objectContaining({ subject: 'wip' })],
      releaseType: 'minor',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      tag: 'v1.1.0',
      bumpedFiles: ['./package.json'],
      changelogFiles: ['CHANGELOG.md'],
      commits: [expect.objectContaining({ subject: 'feat: Ship it' })],
    });
  });

  it('plans previews in the changelog dir when requested', () => {
    const planned = planTargetRelease(makeArgs({ shouldPlanPreviews: true }));

    expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: 'packages/core', tag: 'core-v1.1.0' }),
    );
    expect(planned.writes.at(-1)?.path).toBe('docs/RELEASE_NOTES.md');
    expect(planned.result.previewFiles).toStrictEqual(['docs/RELEASE_NOTES.md']);
    expect(planned.warnings).toStrictEqual(['README.md not found']);
  });

  it('applies the workspace override tier to a package and the root tier alone to a composite', () => {
    const overrideContext = makeOverrideContext();
    overrideContext.overridesByWorkspace.set('.', new Map([['abc1234', { audience: 'skip' }]]));

    planTargetRelease(
      makeArgs({ target: PROJECT, history: makeReleaseHistory({ ...FEATURE_HISTORY }), overrideContext }),
    );

    expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledWith(
      '.meta/changelog.json',
      expect.arrayContaining([expect.objectContaining({ sections: FEATURE_HISTORY.sections })]),
    );
    expect(overrideContext.overrideWarnings).toStrictEqual([]);
  });

  it('skips an item under the workspace tier of the package that it belongs to', () => {
    const overrideContext = makeOverrideContext();
    overrideContext.overridesByWorkspace.set('packages/core', new Map([['abc1234', { audience: 'skip' }]]));

    planTargetRelease(makeArgs({ overrideContext }));

    const [, entries] = mockMergeChangelogEntriesWithDisk.mock.lastCall ?? [];
    expect(entries).toStrictEqual([expect.objectContaining({ sections: [] })]);
  });
});

describe(buildSkippedTargetResult, () => {
  const history = makeReleaseHistory({ previousTag: 'v1.0.0', commits: [['chore: tidy', 'abc1234']] });

  it('names a skipped workspace', () => {
    expect(buildSkippedTargetResult(CORE, history, 'nothing')).toStrictEqual({
      targetId: 'core',
      status: 'skipped',
      kind: 'package',
      name: 'core',
      previousTag: 'v1.0.0',
      commitCount: 1,
      parsedCommitCount: 0,
      skipReason: 'nothing',
    });
  });

  it('leaves the single-package root unnamed', () => {
    expect(buildSkippedTargetResult(ROOT, history, 'nothing')).not.toHaveProperty('name');
  });

  it('builds a skipped composite', () => {
    expect(buildSkippedTargetResult(PROJECT, history, 'nothing')).toMatchObject({
      targetId: '',
      kind: 'composite',
      status: 'skipped',
    });
  });
});

// region | Helpers

/** Builds the arguments of a direct minor release of `core`, overriding the given fields. */
function makeArgs(overrides: Partial<PlanTargetReleaseArgs> = {}): PlanTargetReleaseArgs {
  const history: ReleaseHistory = makeReleaseHistory({ ...FEATURE_HISTORY });
  return {
    target: CORE,
    settings: SETTINGS,
    release: { releaseType: 'minor' },
    decision: { outcome: 'release', releaseType: 'minor', bumpOverride: undefined, setVersion: undefined },
    history,
    overrideContext: makeOverrideContext(),
    sectionOrder: ['Features'],
    dependenciesHeader: 'Dependencies',
    shouldPlanPreviews: false,
    today: '2024-02-02',
    ...overrides,
  };
}

/** Builds an override context without any overrides. */
function makeOverrideContext(): OverrideContext {
  return {
    projectOverrides: new Map(),
    overridesByWorkspace: new Map(),
    overrideWarnings: [],
    globalMatchedRootKeys: new Set(),
  };
}

// endregion | Helpers
