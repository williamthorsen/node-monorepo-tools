import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockHasPrettierConfig = vi.hoisted(() => vi.fn());
const mockWriteReleaseNotesPreviews = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../resolveCliffConfigPath.ts', () => ({
  resolveCliffConfigPath: () => 'cliff.toml',
}));

vi.mock('../hasPrettierConfig.ts', () => ({
  hasPrettierConfig: mockHasPrettierConfig,
}));

vi.mock('../writeReleaseNotesPreviews.ts', () => ({
  writeReleaseNotesPreviews: mockWriteReleaseNotesPreviews,
}));

// Stub the new helpers when tests exercise the changelogJson-enabled path, so no git-cliff
// invocation or filesystem access is required.
const mockBuildChangelogEntries = vi.hoisted(() => vi.fn());
const mockUpsertChangelogJson = vi.hoisted(() => vi.fn());

vi.mock('../buildChangelogEntries.ts', () => ({
  buildChangelogEntries: mockBuildChangelogEntries,
}));

vi.mock('../changelogJsonFile.ts', () => ({
  resolveChangelogJsonPath: (config: { changelogJson: { outputPath: string } }, changelogPath: string): string =>
    `${changelogPath}/${config.changelogJson.outputPath}`,
  writeChangelogJson: vi.fn(),
  upsertChangelogJson: mockUpsertChangelogJson,
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
      return 'feat: add feature\u001Fabc123';
    }
    return '';
  });
  mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));
}

describe(releasePrepare, () => {
  beforeEach(() => {
    mockBuildChangelogEntries.mockReturnValue([]);
    mockUpsertChangelogJson.mockImplementation((filePath: string) => filePath);
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
    mockWriteReleaseNotesPreviews.mockReset();
    mockBuildChangelogEntries.mockReset();
    mockUpsertChangelogJson.mockReset();
    vi.restoreAllMocks();
  });

  it('returns a PrepareResult with a released workspace on success', () => {
    setupFeatCommit();

    const result = releasePrepare(makeConfig(), { dryRun: false });

    expect(result.tags).toStrictEqual(['v1.1.0']);
    expect(result.dryRun).toBe(false);
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
    expect(workspace.changelogFiles).toStrictEqual(['./CHANGELOG.md']);
  });

  it('applies patch floor when commits exist but none are release-worthy', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u001Fabc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepare(makeConfig(), { dryRun: false });

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
        return 'feat: add feature\u001Fabc123\nchore: update deps\u001Fdef456';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepare(makeConfig(), { dryRun: false });

    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      parsedCommitCount: 1,
    });
    expect(result.workspaces[0]?.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'def456' }]);
  });

  it('runs format command with package files and changelog paths appended', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      packageFiles: ['package.json', 'packages/core/package.json'],
      changelogPaths: ['.', 'packages/core'],
    });
    setupFeatCommit();

    const result = releasePrepare(config, { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx prettier --write package.json packages/core/package.json ./CHANGELOG.md packages/core/CHANGELOG.md',
      { stdio: 'inherit' },
    );
    expect(result.formatCommand).toMatchObject({ executed: true });
  });

  it('captures format command without executing in dry-run mode', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      packageFiles: ['package.json'],
      changelogPaths: ['.'],
    });
    setupFeatCommit();

    const result = releasePrepare(config, { dryRun: true });

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result.formatCommand).toMatchObject({
      command: 'npx prettier --write package.json ./CHANGELOG.md',
      executed: false,
    });
  });

  it('defaults to prettier when no formatCommand is set and prettier config exists', () => {
    setupFeatCommit();
    mockHasPrettierConfig.mockReturnValue(true);

    const result = releasePrepare(makeConfig(), { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith('npx prettier --write package.json ./CHANGELOG.md', {
      stdio: 'inherit',
    });
    expect(result.formatCommand).toMatchObject({ executed: true });
  });

  it('skips formatting when no formatCommand is set and no prettier config exists', () => {
    setupFeatCommit();
    mockHasPrettierConfig.mockReturnValue(false);

    const result = releasePrepare(makeConfig(), { dryRun: false });

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result.formatCommand).toBeUndefined();
  });

  it('uses bumpOverride directly, bypassing commit-based bump detection', () => {
    setupFeatCommit();

    const result = releasePrepare(makeConfig(), { dryRun: false, bumpOverride: 'patch' });

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
        return 'feat: add feature\u001Fabc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepare(makeConfig({ tagPrefix: 'my-lib-v' }), { dryRun: false });

    expect(result.tags).toStrictEqual(['my-lib-v1.1.0']);
    expect(result.workspaces[0]).toMatchObject({
      tag: 'my-lib-v1.1.0',
    });
  });

  it('populates tags in dry-run mode', () => {
    setupFeatCommit();

    const result = releasePrepare(makeConfig(), { dryRun: true });

    expect(result.tags).toStrictEqual(['v1.1.0']);
    expect(result.dryRun).toBe(true);
  });

  it('writes the explicit --set-version value, bypassing commit-derived bumps', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v0.5.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: unrelated change\u001Fabc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'pkg', version: '0.5.0' }));

    const result = releasePrepare(makeConfig(), { dryRun: false, setVersion: '1.0.0' });

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
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'package.json',
      expect.stringContaining('"version": "1.0.0"'),
      'utf8',
    );
  });

  it('writes a synthetic empty-range changelog when --set-version is used with zero commits', () => {
    // `commits.length === 0` routes to `writeEmptyReleaseChangelog` instead of git-cliff,
    // avoiding the `WARN  git_cliff > There is already a tag` noise (issue #369).
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

    const result = releasePrepare(makeConfig(), { dryRun: false, setVersion: '1.0.0' });

    const workspace = result.workspaces[0];
    if (workspace?.status !== 'released') throw new Error('expected released');
    expect(workspace.changelogFiles).toStrictEqual(['./CHANGELOG.md']);

    // Synthetic write to CHANGELOG.md: header + Notes section + bullet.
    const changelogWrite = mockWriteFileSync.mock.calls.find((call: unknown[]) => call[0] === './CHANGELOG.md');
    expect(changelogWrite).toBeDefined();
    expect(changelogWrite?.[1]).toContain('## 1.0.0');
    expect(changelogWrite?.[1]).toContain('### Notes');
    expect(changelogWrite?.[1]).toContain('- Forced version bump.');

    // No git-cliff *work* invocation (filter on `--config` to exclude the cache-refresh call).
    const cliffCalls = mockExecFileSync.mock.calls.filter(
      (call: unknown[]) =>
        call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff') && call[1].includes('--config'),
    );
    expect(cliffCalls).toHaveLength(0);
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

    expect(() => releasePrepare(makeConfig(), { dryRun: false, setVersion: '0.3.0' })).toThrow(
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

    expect(() => releasePrepare(makeConfig(), { dryRun: false, setVersion: '0.5.0' })).toThrow(
      '--set-version 0.5.0 is not greater than current version 0.5.0',
    );
  });

  it('calls writeReleaseNotesPreviews when --with-release-notes is set and changelogJson is enabled', () => {
    setupFeatCommit();
    vi.spyOn(process, 'cwd').mockReturnValue('/single-pkg');

    releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
      dryRun: false,
      withReleaseNotes: true,
    });

    expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledTimes(1);
    expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: '/single-pkg',
        tag: 'v1.1.0',
        dryRun: false,
        sectionOrder: expect.any(Array),
        changelogJsonPath: './.meta/changelog.json',
      }),
    );
  });

  it('warns and skips preview generation when --with-release-notes is set but changelogJson is disabled', () => {
    setupFeatCommit();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    releasePrepare(makeConfig(), { dryRun: false, withReleaseNotes: true });

    expect(mockWriteReleaseNotesPreviews).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('--with-release-notes requires changelogJson.enabled'),
    );
  });

  it('does not call writeReleaseNotesPreviews when --with-release-notes is not set', () => {
    setupFeatCommit();

    releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
      dryRun: false,
    });

    expect(mockWriteReleaseNotesPreviews).not.toHaveBeenCalled();
  });

  it('propagates dryRun to writeReleaseNotesPreviews', () => {
    setupFeatCommit();

    releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
      dryRun: true,
      withReleaseNotes: true,
    });

    expect(mockWriteReleaseNotesPreviews).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
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

      const result = releasePrepare(makeConfig(), { dryRun: false, bumpOverride: 'patch' });

      expect(result.tags).toStrictEqual(['v1.0.1']);
      const workspace = result.workspaces[0];
      if (workspace?.status !== 'released') throw new Error('expected released');
      expect(workspace.changelogFiles).toStrictEqual(['./CHANGELOG.md']);

      const changelogWrite = mockWriteFileSync.mock.calls.find((call: unknown[]) => call[0] === './CHANGELOG.md');
      expect(changelogWrite?.[1]).toContain('## 1.0.1');
      expect(changelogWrite?.[1]).toContain('### Notes');
      expect(changelogWrite?.[1]).toContain('- Forced version bump.');
    });

    it('does not invoke git-cliff for empty-range releases', () => {
      stubEmptyRange();

      releasePrepare(makeConfig(), { dryRun: false, bumpOverride: 'minor' });

      // Empty-range releases must bypass git-cliff entirely so consumers do not see
      // `WARN  git_cliff > There is already a tag` lines (issue #369).
      expect(countCliffWorkCalls()).toBe(0);
    });

    it('upserts a synthetic empty-range entry into changelog.json when enabled', () => {
      stubEmptyRange();

      releasePrepare(makeConfig({ changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true } }), {
        dryRun: false,
        bumpOverride: 'patch',
      });

      expect(mockUpsertChangelogJson).toHaveBeenCalledTimes(1);
      const upsertEntries = mockUpsertChangelogJson.mock.calls[0]?.[1];
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
          dryRun: true,
          bumpOverride: 'patch',
        },
      );

      expect(result.tags).toStrictEqual(['v1.0.1']);
      // No CHANGELOG.md write under dry-run.
      const changelogWrites = mockWriteFileSync.mock.calls.filter((call: unknown[]) => call[0] === './CHANGELOG.md');
      expect(changelogWrites).toHaveLength(0);
      // Upsert is also skipped under dry-run, but the path still flows into formatCommand.
      expect(mockUpsertChangelogJson).not.toHaveBeenCalled();
      const workspace = result.workspaces[0];
      if (workspace?.status !== 'released') throw new Error('expected released');
      expect(workspace.changelogFiles).toStrictEqual(['./CHANGELOG.md']);
    });

    it('appends synthetic CHANGELOG.md and changelog.json paths to formatCommand.files', () => {
      stubEmptyRange();
      const config = makeConfig({
        formatCommand: 'npx prettier --write',
        changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: true },
      });

      const result = releasePrepare(config, { dryRun: true, bumpOverride: 'patch' });

      expect(result.formatCommand?.files).toContain('./CHANGELOG.md');
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

    const result = releasePrepare(makeConfig(), { dryRun: true, setVersion: '1.0.0' });

    expect(result.tags).toStrictEqual(['v1.0.0']);
    expect(result.dryRun).toBe(true);
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

      const result = releasePrepare(configWithDefaultWorkTypes(), { dryRun: false });

      expect(result.workspaces[0]?.policyViolations).toBeUndefined();
    });

    it('records a prefix-surface violation for an internal! commit (forbidden policy)', () => {
      stubLog('internal!: refactor cache', 'def5678');

      const result = releasePrepare(configWithDefaultWorkTypes(), { dryRun: false });

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

      const result = releasePrepare(configWithDefaultWorkTypes(), { dryRun: false });

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

      const result = releasePrepare(configWithDefaultWorkTypes({ breakingPolicies: {} }), { dryRun: false });

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

      const result = releasePrepare(config, { dryRun: false });

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

      const result = releasePrepare(config, { dryRun: false });

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
      const result = releasePrepare(configWithDefaultWorkTypes(), { dryRun: false });

      expect(result.workspaces[0]?.status).toBe('released');
      expect(result.workspaces[0]?.policyViolations).toHaveLength(1);
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

      releasePrepare(makeConfig(), { dryRun: false });

      const warmupIndices = findWarmupCallIndices();
      const workIndices = findCliffWorkCallIndices();
      expect(warmupIndices).toHaveLength(1);
      expect(workIndices.length).toBeGreaterThan(0);
      const firstWarmup = warmupIndices[0] ?? Number.POSITIVE_INFINITY;
      const firstWork = workIndices[0] ?? Number.NEGATIVE_INFINITY;
      expect(firstWarmup).toBeLessThan(firstWork);
    });

    it('refreshes the git-cliff cache even in dry-run mode (cliff is invoked under dry-run for changelog.json)', () => {
      setupFeatCommit();

      releasePrepare(makeConfig(), { dryRun: true });

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

      const result = releasePrepare(makeConfig(), { dryRun: false });

      // Sanity: confirm the test actually exercised the skip path.
      expect(result.workspaces[0]?.status).toBe('skipped');
      expect(findWarmupCallIndices()).toHaveLength(0);
    });
  });
});
