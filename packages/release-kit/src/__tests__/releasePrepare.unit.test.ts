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

describe(releasePrepare, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockHasPrettierConfig.mockReset();
    vi.restoreAllMocks();
  });

  it('runs format command with package files and changelog paths appended', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      packageFiles: ['package.json', 'packages/core/package.json'],
      changelogPaths: ['.', 'packages/core'],
    });

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

    releasePrepare(config, { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx prettier --write package.json packages/core/package.json ./CHANGELOG.md packages/core/CHANGELOG.md',
      { stdio: 'inherit' },
    );
  });

  it('logs full command with file paths in dry-run mode', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      packageFiles: ['package.json'],
      changelogPaths: ['.'],
    });

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

    releasePrepare(config, { dryRun: true });

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('npx prettier --write package.json ./CHANGELOG.md'));
  });

  it('does not run format command when no release-worthy changes exist', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
    });

    // Return a commit whose type (chore) is not in workTypes (only feat, fix)
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u001Fabc123';
      }
      return '';
    });

    const result = releasePrepare(config, { dryRun: false });

    expect(result).toStrictEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('defaults to prettier when no formatCommand is set and prettier config exists', () => {
    const config = makeConfig();
    mockHasPrettierConfig.mockReturnValue(true);

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

    releasePrepare(config, { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith('npx prettier --write package.json ./CHANGELOG.md', {
      stdio: 'inherit',
    });
  });

  it('skips formatting when no formatCommand is set and no prettier config exists', () => {
    const config = makeConfig();
    mockHasPrettierConfig.mockReturnValue(false);

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

    releasePrepare(config, { dryRun: false });

    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
