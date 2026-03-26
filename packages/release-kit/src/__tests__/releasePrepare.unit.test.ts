import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockHasPrettierConfig = vi.hoisted(() => vi.fn());

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
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockHasPrettierConfig.mockReset();
    vi.restoreAllMocks();
  });

  it('returns a PrepareResult with a released component on success', () => {
    setupFeatCommit();

    const result = releasePrepare(makeConfig(), { dryRun: false });

    expect(result.tags).toStrictEqual(['v1.1.0']);
    expect(result.dryRun).toBe(false);
    expect(result.components).toHaveLength(1);

    const component = result.components[0];
    expect(component).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      tag: 'v1.1.0',
      commitCount: 1,
      parsedCommitCount: 1,
    });
    expect(component?.name).toBeUndefined();
    expect(component?.bumpedFiles).toStrictEqual(['package.json']);
    expect(component?.changelogFiles).toStrictEqual(['./CHANGELOG.md']);
  });

  it('returns a skipped component when no release-worthy changes exist', () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u001Fabc123';
      }
      return '';
    });

    const result = releasePrepare(makeConfig({ formatCommand: 'npx prettier --write' }), { dryRun: false });

    expect(result.tags).toStrictEqual([]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      status: 'skipped',
      commitCount: 1,
      parsedCommitCount: 0,
      skipReason: 'No release-worthy changes found',
    });
    expect(mockExecSync).not.toHaveBeenCalled();
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
});
