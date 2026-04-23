import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockHasPrettierConfig = vi.hoisted(() => vi.fn());
const mockWriteReleaseNotesPreviews = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock('node:fs', () => ({
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

// Stub generateChangelogJson when tests exercise the enabled path, so no git-cliff invocation
// or filesystem access is required.
const mockGenerateChangelogJson = vi.hoisted(() => vi.fn());

vi.mock('../generateChangelogJson.ts', () => ({
  generateChangelogJson: mockGenerateChangelogJson,
}));

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
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
    mockGenerateChangelogJson.mockImplementation((_config, changelogPath: string) => [
      `${changelogPath}/.meta/changelog.json`,
    ]);
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockHasPrettierConfig.mockReset();
    mockWriteReleaseNotesPreviews.mockReset();
    mockGenerateChangelogJson.mockReset();
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
    expect(workspace?.bumpedFiles).toStrictEqual(['package.json']);
    expect(workspace?.changelogFiles).toStrictEqual(['./CHANGELOG.md']);
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
    expect(result.workspaces[0]).toMatchObject({
      status: 'released',
      newVersion: '1.0.0',
      currentVersion: '0.5.0',
      tag: 'v1.0.0',
      setVersion: '1.0.0',
    });
    expect(result.workspaces[0]?.releaseType).toBeUndefined();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'package.json',
      expect.stringContaining('"version": "1.0.0"'),
      'utf8',
    );
  });

  it('still generates a changelog when using --set-version', () => {
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

    expect(result.workspaces[0]?.changelogFiles).toStrictEqual(['./CHANGELOG.md']);
    const cliffCalls = mockExecFileSync.mock.calls.filter(
      (call: unknown[]) => call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff'),
    );
    expect(cliffCalls).toHaveLength(1);
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
});
