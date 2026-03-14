import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

import { generateChangelog, generateChangelogs } from '../generateChangelogs.ts';
import type { ReleaseConfig } from '../types.ts';

describe(generateChangelog, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('calls git-cliff with base args when no includePaths are provided', () => {
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, 'packages/arrays', 'v1.0.0', false);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git-cliff',
      ['--config', 'cliff.toml', '--output', 'packages/arrays/CHANGELOG.md', '--tag', 'v1.0.0'],
      { stdio: 'inherit' },
    );
  });

  it('appends --include-path flags when includePaths are provided', () => {
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, 'packages/arrays', 'arrays-v1.0.0', false, {
      includePaths: ['packages/arrays'],
    });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git-cliff',
      [
        '--config',
        'cliff.toml',
        '--output',
        'packages/arrays/CHANGELOG.md',
        '--tag',
        'arrays-v1.0.0',
        '--include-path',
        'packages/arrays',
      ],
      { stdio: 'inherit' },
    );
  });

  it('appends multiple --include-path flags for multiple paths', () => {
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, '.', 'v2.0.0', false, {
      includePaths: ['packages/arrays', 'packages/strings'],
    });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git-cliff',
      [
        '--config',
        'cliff.toml',
        '--output',
        './CHANGELOG.md',
        '--tag',
        'v2.0.0',
        '--include-path',
        'packages/arrays',
        '--include-path',
        'packages/strings',
      ],
      { stdio: 'inherit' },
    );
  });

  it('does not append --include-path flags when includePaths is an empty array', () => {
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, 'packages/arrays', 'v1.0.0', false, { includePaths: [] });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git-cliff',
      ['--config', 'cliff.toml', '--output', 'packages/arrays/CHANGELOG.md', '--tag', 'v1.0.0'],
      { stdio: 'inherit' },
    );
  });

  it('does not call execFileSync when dryRun is true', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, 'packages/arrays', 'v1.0.0', true);

    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[dry-run]'));
    infoSpy.mockRestore();
  });

  it('defaults cliffConfigPath to cliff.toml when absent', () => {
    const config = {};

    generateChangelog(config, 'packages/arrays', 'v1.0.0', false);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git-cliff',
      ['--config', 'cliff.toml', '--output', 'packages/arrays/CHANGELOG.md', '--tag', 'v1.0.0'],
      { stdio: 'inherit' },
    );
  });
});

describe(generateChangelogs, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('calls git-cliff for each configured changelog path', () => {
    const config = {
      tagPrefix: 'v',
      packageFiles: [],
      changelogPaths: ['packages/arrays', 'packages/strings'],
      workTypes: {},
      cliffConfigPath: 'cliff.toml',
    } satisfies ReleaseConfig;

    generateChangelogs(config, 'v1.0.0', false);

    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git-cliff',
      ['--config', 'cliff.toml', '--output', 'packages/arrays/CHANGELOG.md', '--tag', 'v1.0.0'],
      { stdio: 'inherit' },
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git-cliff',
      ['--config', 'cliff.toml', '--output', 'packages/strings/CHANGELOG.md', '--tag', 'v1.0.0'],
      { stdio: 'inherit' },
    );
  });
});
