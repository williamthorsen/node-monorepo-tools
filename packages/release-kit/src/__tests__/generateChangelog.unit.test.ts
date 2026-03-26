import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockResolveCliffConfigPath = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('../resolveCliffConfigPath.ts', () => ({
  resolveCliffConfigPath: mockResolveCliffConfigPath,
}));

import { generateChangelog, generateChangelogs } from '../generateChangelogs.ts';
import type { ReleaseConfig } from '../types.ts';

describe(generateChangelog, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockResolveCliffConfigPath.mockReset();
  });

  it('calls git-cliff with base args when no includePaths are provided', () => {
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = { cliffConfigPath: 'cliff.toml' };

    const result = generateChangelog(config, 'packages/arrays', 'v1.0.0', false);

    expect(result).toStrictEqual(['packages/arrays/CHANGELOG.md']);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['--yes', 'git-cliff', '--config', 'cliff.toml', '--output', 'packages/arrays/CHANGELOG.md', '--tag', 'v1.0.0'],
      { stdio: 'inherit' },
    );
  });

  it('appends --include-path flags when includePaths are provided', () => {
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = { cliffConfigPath: 'cliff.toml' };

    const result = generateChangelog(config, 'packages/arrays', 'arrays-v1.0.0', false, {
      includePaths: ['packages/arrays'],
    });

    expect(result).toStrictEqual(['packages/arrays/CHANGELOG.md']);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      [
        '--yes',
        'git-cliff',
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
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = { cliffConfigPath: 'cliff.toml' };

    const result = generateChangelog(config, '.', 'v2.0.0', false, {
      includePaths: ['packages/arrays', 'packages/strings'],
    });

    expect(result).toStrictEqual(['./CHANGELOG.md']);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      [
        '--yes',
        'git-cliff',
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
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, 'packages/arrays', 'v1.0.0', false, { includePaths: [] });

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['--yes', 'git-cliff', '--config', 'cliff.toml', '--output', 'packages/arrays/CHANGELOG.md', '--tag', 'v1.0.0'],
      { stdio: 'inherit' },
    );
  });

  it('returns the output file path without calling execFileSync when dryRun is true', () => {
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = { cliffConfigPath: 'cliff.toml' };

    const result = generateChangelog(config, 'packages/arrays', 'v1.0.0', true);

    expect(result).toStrictEqual(['packages/arrays/CHANGELOG.md']);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('uses the path returned by resolveCliffConfigPath when cliffConfigPath is absent', () => {
    mockResolveCliffConfigPath.mockReturnValue('/bundled/cliff.toml.template');
    const config = {};

    const result = generateChangelog(config, 'packages/arrays', 'v1.0.0', false);

    expect(result).toStrictEqual(['packages/arrays/CHANGELOG.md']);
    expect(mockResolveCliffConfigPath).toHaveBeenCalledWith(undefined, expect.any(String));
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      [
        '--yes',
        'git-cliff',
        '--config',
        '/bundled/cliff.toml.template',
        '--output',
        'packages/arrays/CHANGELOG.md',
        '--tag',
        'v1.0.0',
      ],
      { stdio: 'inherit' },
    );
  });
});

describe(generateChangelogs, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockResolveCliffConfigPath.mockReset();
  });

  it('returns collected file paths from all changelog paths', () => {
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = {
      tagPrefix: 'v',
      packageFiles: [],
      changelogPaths: ['packages/arrays', 'packages/strings'],
      workTypes: {},
      cliffConfigPath: 'cliff.toml',
    } satisfies ReleaseConfig;

    const result = generateChangelogs(config, 'v1.0.0', false);

    expect(result).toStrictEqual(['packages/arrays/CHANGELOG.md', 'packages/strings/CHANGELOG.md']);
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });
});
