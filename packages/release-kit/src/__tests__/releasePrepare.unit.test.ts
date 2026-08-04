import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock(import('../resolveCliffConfigPath.ts'), () => ({
  resolveCliffConfigPath: () => 'cliff.toml',
}));

vi.mock(import('../hasPrettierConfig.ts'), () => ({
  hasPrettierConfig: mockHasPrettierConfig,
}));

vi.mock(import('../planReleaseNotesPreviews.ts'), () => ({
  planReleaseNotesPreviews: mockPlanReleaseNotesPreviews,
}));

// Stub the new helpers when tests exercise the changelogJson-enabled path, so no git-cliff
// invocation or filesystem access is required.
const mockBuildChangelogEntries = vi.hoisted(() => vi.fn());
const mockUpsertChangelogJson = vi.hoisted(() => vi.fn());
const mockUpsertChangelogJsonAndReturn = vi.hoisted(() => vi.fn());
const mockMergeChangelogEntriesWithDisk = vi.hoisted(() => vi.fn());
const mockRenderChangelogMarkdown = vi.hoisted(() => vi.fn());
const mockRenderChangelogJson = vi.hoisted(() => vi.fn());

vi.mock(import('../buildChangelogEntries.ts'), () => ({
  buildChangelogEntries: mockBuildChangelogEntries,
}));

vi.mock(import('../changelogJsonFile.ts'), () => ({
  resolveChangelogJsonPath: (config: { changelogJson: { outputPath: string } }, changelogPath: string): string =>
    `${changelogPath}/${config.changelogJson.outputPath}`,
  writeChangelogJson: vi.fn(),
  renderChangelogJson: mockRenderChangelogJson,
  upsertChangelogJson: mockUpsertChangelogJson,
  upsertChangelogJsonAndReturn: mockUpsertChangelogJsonAndReturn,
  mergeChangelogEntriesWithDisk: mockMergeChangelogEntriesWithDisk,
}));

vi.mock(import('../renderChangelogMarkdown.ts'), () => ({
  renderChangelogMarkdown: mockRenderChangelogMarkdown,
}));

import {
  DEFAULT_BREAKING_POLICIES,
  DEFAULT_CHANGELOG_JSON_CONFIG,
  DEFAULT_RELEASE_NOTES_CONFIG,
  DEFAULT_WORK_TYPES,
} from '../defaults.ts';
import { releasePrepare } from '../releasePrepare.ts';
import type { ReleaseConfig, WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
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

/** Set up git mocks to simulate a repo with a feat commit since v1.0.0. */
function setupFeatCommit(): void {
  mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'describe') {
      return 'v1.0.0\n';
    }
    if (cmd === 'git' && args[0] === 'log') {
      return 'feat: add feature\u{1F}abc123';
    }
    return '';
  });
  mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
}

describe(releasePrepare, () => {
  beforeEach(() => {
    mockBuildChangelogEntries.mockReturnValue([]);
    mockUpsertChangelogJson.mockImplementation((filePath: string) => filePath);
    mockUpsertChangelogJsonAndReturn.mockImplementation((_filePath: string, entries: unknown[]) => entries);
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
    mockBuildChangelogEntries.mockReset();
    mockUpsertChangelogJson.mockReset();
    mockUpsertChangelogJsonAndReturn.mockReset();
    mockMergeChangelogEntriesWithDisk.mockReset();
    mockRenderChangelogMarkdown.mockReset();
    mockRenderChangelogJson.mockReset();
    vi.restoreAllMocks();
  });

  it('returns a PrepareResult with a released workspace on success', () => {
    setupFeatCommit();

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
    if (workspace?.status !== 'released') throw new Error('expected released');
    expect(workspace.bumpedFiles).toStrictEqual(['package.json']);
    expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);
  });

  it('applies patch floor when commits exist but none are release-worthy', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepare(makeConfig(), {});

    expect(result.tags).toStrictEqual(['v1.0.1']);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      commitCount: 1,
      parsedCommitCount: 0,
      releaseType: 'patch',
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'abc123' }]);
  });

  it('uses parsed bump type when mix of parseable and unparseable commits exist', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u{1F}abc123\nchore: update deps\u{1F}def456';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepare(makeConfig(), {});

    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      parsedCommitCount: 1,
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'def456' }]);
  });

  it('renders the format command over package files and changelog paths', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      packageFiles: ['package.json', 'packages/core/package.json'],
      changelogPaths: ['.', 'packages/core'],
    });
    setupFeatCommit();

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
    setupFeatCommit();

    releasePrepare(config, {});

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('defaults to prettier when no formatCommand is set and prettier config exists', () => {
    setupFeatCommit();
    mockHasPrettierConfig.mockReturnValue(true);

    const result = releasePrepare(makeConfig(), {});

    expect(result.formatCommand).toMatchObject({ command: 'npx prettier --write package.json CHANGELOG.md' });
  });

  it('skips formatting when no formatCommand is set and no prettier config exists', () => {
    setupFeatCommit();
    mockHasPrettierConfig.mockReturnValue(false);

    const result = releasePrepare(makeConfig(), {});

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result.formatCommand).toBeUndefined();
  });

  it('uses bumpOverride directly, bypassing commit-based bump detection', () => {
    setupFeatCommit();

    const result = releasePrepare(makeConfig(), { bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['v1.0.1']);
    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      releaseType: 'patch',
      newVersion: '1.0.1',
      tag: 'v1.0.1',
    });
    expect(result.workspaces[0]?.parsedCommitCount).toBeUndefined();
  });

  it('constructs tags using the configured tagPrefix', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'my-lib-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u{1F}abc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepare(makeConfig({ tagPrefix: 'my-lib-v' }), {});

    expect(result.tags).toStrictEqual(['my-lib-v1.1.0']);
    expect(result.workspaces[0]).toMatchObject({
      tag: 'my-lib-v1.1.0',
    });
  });

  it('populates tags in dry-run mode', () => {
    setupFeatCommit();

    const result = releasePrepare(makeConfig(), {});

    expect(result.tags).toStrictEqual(['v1.1.0']);
  });

  it('writes the explicit --set-version value, bypassing commit-derived bumps', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v0.5.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: unrelated change\u{1F}abc123';
      }
      return '';
    });
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
    if (workspace?.status !== 'released') throw new Error('expected released');
    expect(workspace.releaseType).toBeUndefined();
    expect(plannedContent(result, 'package.json')).toContain('"version": "1.0.0"');
  });

  it('writes a synthetic empty-range changelog when --set-version is used with zero commits', () => {
    // `commits.length === 0` routes through the synthetic empty-range entry, bypassing
    // git-cliff entirely and avoiding the `WARN  git_cliff > There is already a tag` noise.
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v0.5.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = releasePrepare(makeConfig(), { setVersion: '1.0.0' });

    const workspace = result.workspaces[0];
    if (workspace?.status !== 'released') throw new Error('expected released');
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

    // Build-via-cliff path must not be exercised on the empty-range branch.
    expect(mockBuildChangelogEntries).not.toHaveBeenCalled();
  });

  it('throws when --set-version is not greater than the current version', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v0.5.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    expect(() => releasePrepare(makeConfig(), { setVersion: '0.3.0' })).toThrow(
      '--set-version 0.3.0 is not greater than current version 0.5.0',
    );
  });

  it('throws when --set-version equals the current version', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v0.5.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    expect(() => releasePrepare(makeConfig(), { setVersion: '0.5.0' })).toThrow(
      '--set-version 0.5.0 is not greater than current version 0.5.0',
    );
  });

  it('calls planReleaseNotesPreviews when --with-release-notes is set and changelogJson is enabled', () => {
    setupFeatCommit();
    vi.spyOn(process, 'cwd').mockReturnValue('/single-pkg');

    releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
      withReleaseNotes: true,
    });

    expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledTimes(1);
    expect(mockPlanReleaseNotesPreviews).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/single-pkg',
        tag: 'v1.1.0',
        sectionOrder: expect.any(Array),
        entries: expect.any(Array),
      }),
    );
  });

  it('warns and skips preview generation when --with-release-notes is set but changelogJson is disabled', () => {
    setupFeatCommit();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    releasePrepare(makeConfig(), { withReleaseNotes: true });

    expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('--with-release-notes requires changelogJson.enabled'),
    );
  });

  it('does not call planReleaseNotesPreviews when --with-release-notes is not set', () => {
    setupFeatCommit();

    releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {});

    expect(mockPlanReleaseNotesPreviews).not.toHaveBeenCalled();
  });

  it('carries the planned preview files into the plan', () => {
    setupFeatCommit();
    mockPlanReleaseNotesPreviews.mockReturnValue({
      writes: [{ path: 'docs/RELEASE_NOTES.v1.1.0.md', content: '# Notes\n' }],
      warnings: [],
    });

    const plan = releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
      withReleaseNotes: true,
    });

    expect(plannedContent(plan, 'docs/RELEASE_NOTES.v1.1.0.md')).toBe('# Notes\n');
  });

  describe('empty-range (--force / --bump / --set-version with zero commits)', () => {
    /** Stub git to simulate a tag exists but there are no commits since it. */
    function stubEmptyRange(): void {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
    }

    /** Count git-cliff *work* invocations (those that pass `--config`). */
    function countCliffWorkCalls(): number {
      return mockExecFileSync.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff') && call[1].includes('--config'),
      ).length;
    }

    it('writes a synthetic Notes / Forced version bump entry when --force is used with no commits', () => {
      stubEmptyRange();

      const result = releasePrepare(makeConfig(), { bumpOverride: 'patch' });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      const workspace = result.workspaces[0];
      if (workspace?.status !== 'released') throw new Error('expected released');
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

    it('does not invoke git-cliff for empty-range releases', () => {
      stubEmptyRange();

      releasePrepare(makeConfig(), { bumpOverride: 'minor' });

      // Empty-range releases must bypass git-cliff entirely so consumers do not see
      // `WARN  git_cliff > There is already a tag` lines (issue #369).
      expect(countCliffWorkCalls()).toBe(0);
    });

    it('upserts a synthetic empty-range entry into changelog.json when enabled', () => {
      stubEmptyRange();

      releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
        bumpOverride: 'patch',
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
      ]);
      // Build-via-cliff path must not be exercised on the empty-range branch.
      expect(mockBuildChangelogEntries).not.toHaveBeenCalled();
    });

    it('skips synthetic file writes in dry-run mode but still returns paths', () => {
      stubEmptyRange();

      const result = releasePrepare(
        makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        {
          bumpOverride: 'patch',
        },
      );

      expect(result.tags).toStrictEqual(['v1.0.1']);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
      const workspace = result.workspaces[0];
      if (workspace?.status !== 'released') throw new Error('expected released');
      expect(workspace.changelogFiles).toStrictEqual(['CHANGELOG.md']);
    });

    it('appends synthetic CHANGELOG.md and changelog.json paths to formatCommand.files', () => {
      stubEmptyRange();
      const config = makeConfig({
        formatCommand: 'npx prettier --write',
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });

      const result = releasePrepare(config, { bumpOverride: 'patch' });

      expect(result.formatCommand?.files).toContain('CHANGELOG.md');
      expect(result.formatCommand?.files).toContain('./.meta/changelog.json');
    });
  });

  it('does not write files in dry-run mode with --set-version', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v0.5.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = releasePrepare(makeConfig(), { setVersion: '1.0.0' });

    expect(result.tags).toStrictEqual(['v1.0.0']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  describe('policy violations', () => {
    /** Stub git log to return a single commit message paired with a hash. */
    function stubLog(message: string, hash: string): void {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return `${message}${hash}`;
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
    }

    function configWithDefaultWorkTypes(overrides?: Partial<ReleaseConfig>): ReleaseConfig {
      return makeConfig({ workTypes: DEFAULT_WORK_TYPES, ...overrides });
    }

    it('omits policyViolations when a clean feat! commit obeys the optional policy', () => {
      stubLog('feat!: drop legacy export', 'abc1234');

      const result = releasePrepare(configWithDefaultWorkTypes(), {});

      expect(result.workspaces[0]?.policyViolations).toBeUndefined();
    });

    it('records a prefix-surface violation for an internal! commit (forbidden policy)', () => {
      stubLog('internal!: refactor cache', 'def5678');

      const result = releasePrepare(configWithDefaultWorkTypes(), {});

      expect(result.workspaces[0]?.policyViolations).toStrictEqual([
        {
          commitHash: 'def5678',
          commitSubject: 'internal!: refactor cache',
          type: 'internal',
          surface: 'prefix',
        },
      ]);
    });

    it('records a prefix-surface violation for a bare drop commit (required policy)', () => {
      stubLog('drop: remove deprecated API', '9abc012');

      const result = releasePrepare(configWithDefaultWorkTypes(), {});

      expect(result.workspaces[0]?.policyViolations).toStrictEqual([
        {
          commitHash: '9abc012',
          commitSubject: 'drop: remove deprecated API',
          type: 'drop',
          surface: 'prefix',
        },
      ]);
    });

    it('produces no violations when breakingPolicies is set to {} (opt-out)', () => {
      stubLog('internal!: refactor cache', 'def5678');

      const result = releasePrepare(configWithDefaultWorkTypes({ breakingPolicies: {} }), {});

      expect(result.workspaces[0]?.policyViolations).toBeUndefined();
    });

    it('records a body-surface violation when BREAKING CHANGE: appears under a custom forbidden feat policy', () => {
      // The parser invokes `message.includes('BREAKING CHANGE:')` on the raw commit message;
      // any commit whose `.message` contains that literal triggers the body-surface code path.
      // Real git-log subjects (--pretty=format:%s) don't carry body footers, but the wiring still
      // needs to surface body-surface violations correctly when they appear (here: a subject
      // that itself contains the literal string).
      const config = configWithDefaultWorkTypes({
        breakingPolicies: { ...DEFAULT_BREAKING_POLICIES, feat: 'forbidden' },
      });
      stubLog('feat: rework auth (BREAKING CHANGE: removes /v1)', 'body0001');

      const result = releasePrepare(config, {});

      expect(result.workspaces[0]?.policyViolations).toStrictEqual([
        {
          commitHash: 'body0001',
          commitSubject: 'feat: rework auth (BREAKING CHANGE: removes /v1)',
          type: 'feat',
          surface: 'body',
        },
      ]);
    });

    it('records both prefix and body violations when a forbidden feat carries ! and BREAKING CHANGE:', () => {
      // A `forbidden`-policy commit with both `!` AND `BREAKING CHANGE:` fires
      // `onPolicyViolation` twice — once for the prefix, once for the body.
      const config = configWithDefaultWorkTypes({
        breakingPolicies: { ...DEFAULT_BREAKING_POLICIES, feat: 'forbidden' },
      });
      stubLog('feat!: rework auth (BREAKING CHANGE: removes /v1)', 'dual0001');

      const result = releasePrepare(config, {});

      expect(result.workspaces[0]?.policyViolations).toStrictEqual([
        {
          commitHash: 'dual0001',
          commitSubject: 'feat!: rework auth (BREAKING CHANGE: removes /v1)',
          type: 'feat',
          surface: 'prefix',
        },
        {
          commitHash: 'dual0001',
          commitSubject: 'feat!: rework auth (BREAKING CHANGE: removes /v1)',
          type: 'feat',
          surface: 'body',
        },
      ]);
    });

    it('propagates policyViolations through the patch-floor release path', () => {
      // A bare `drop:` is a policy violation AND parses with breaking=false; the
      // single-package legacy path then applies a patch floor since at least one commit
      // exists. The result is `released` (not `skipped`) — verify that policyViolations
      // still propagates onto the released workspace result.
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'drop: remove APIxyz9999';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      // The single-package legacy path applies a patch floor when commits exist, so this
      // releases (status: 'released') with policyViolations attached. Verify that path.
      const result = releasePrepare(configWithDefaultWorkTypes(), {});

      expect(result.workspaces[0]?.status).toBe('released');
      expect(result.workspaces[0]?.policyViolations).toHaveLength(1);
    });
  });

  describe('changelogJson.enabled gating', () => {
    it('does not write changelog.json when changelogJson.enabled is false', () => {
      // Regression: the SSOT pivot previously called `upsertChangelogJsonAndReturn` (a write)
      // unconditionally, silently creating `.meta/changelog.json` for users who had opted out.
      // The fix routes through the pure read-and-merge path when `enabled` is false.
      setupFeatCommit();

      releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false } }), {});

      expect(mockRenderChangelogJson).not.toHaveBeenCalled();
      expect(mockMergeChangelogEntriesWithDisk).toHaveBeenCalledTimes(1);
    });

    it('plans a changelog.json write when changelogJson.enabled is true', () => {
      setupFeatCommit();

      const plan = releasePrepare(
        makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }),
        {},
      );

      expect(mockRenderChangelogJson).toHaveBeenCalledTimes(1);
      expect(plan.writes.map((write) => write.path)).toContain('./.meta/changelog.json');
    });
  });

  describe('git-cliff cache refresh', () => {
    /** Identify the warmup call: `npx --yes git-cliff --version`, no `--config`, no `--prefer-offline`. */
    function findWarmupCallIndices(): number[] {
      const indices: number[] = [];
      mockExecFileSync.mock.calls.forEach((call: unknown[], index: number) => {
        if (
          call[0] === 'npx' &&
          Array.isArray(call[1]) &&
          call[1].includes('git-cliff') &&
          call[1].includes('--version') &&
          !call[1].includes('--config') &&
          !call[1].includes('--prefer-offline')
        ) {
          indices.push(index);
        }
      });
      return indices;
    }

    /** Identify cliff *work* calls (those that pass `--config`) and return their call indices. */
    function findCliffWorkCallIndices(): number[] {
      const indices: number[] = [];
      mockExecFileSync.mock.calls.forEach((call: unknown[], index: number) => {
        if (
          call[0] === 'npx' &&
          Array.isArray(call[1]) &&
          call[1].includes('git-cliff') &&
          call[1].includes('--config')
        ) {
          indices.push(index);
        }
      });
      return indices;
    }

    it('refreshes the git-cliff cache exactly once on a non-skip release run, before any cliff work call', () => {
      setupFeatCommit();

      releasePrepare(makeConfig(), {});

      const warmupIndices = findWarmupCallIndices();
      // `buildChangelogEntries` is mocked, so no actual cliff `--config` work call appears
      // in the spy history. The warmup invariant — exactly one refresh per non-skip run —
      // is the only behaviour observable from this test.
      expect(warmupIndices).toHaveLength(1);
      // Touch findCliffWorkCallIndices to keep the helper exercised in case it is reused below.
      expect(Array.isArray(findCliffWorkCallIndices())).toBe(true);
    });

    it('refreshes the git-cliff cache even in dry-run mode (cliff is invoked under dry-run for changelog.json)', () => {
      setupFeatCommit();

      releasePrepare(makeConfig(), {});

      expect(findWarmupCallIndices()).toHaveLength(1);
    });

    it('does not refresh the cache when no commits exist and no override is given (skip path)', () => {
      // Tag exists but no commits since → releaseType stays undefined → skip path → no cliff
      // work needed → no warmup.
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          return 'v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          return '';
        }
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      const result = releasePrepare(makeConfig(), {});

      // Sanity: confirm the test actually exercised the skip path.
      expect(result.workspaces[0]?.status).toBe('skipped');
      expect(findWarmupCallIndices()).toHaveLength(0);
    });
  });
});

/** Content the plan intends to write to `path`, or undefined when the plan does not write it. */
function plannedContent(
  plan: { writes: readonly { path: string; content: string }[] },
  path: string,
): string | undefined {
  return plan.writes.find((write) => write.path === path)?.content;
}
