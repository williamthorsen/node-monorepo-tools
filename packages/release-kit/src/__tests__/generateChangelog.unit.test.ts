import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockResolveCliffConfigPath = vi.hoisted(() => vi.fn());
const mockCopyFileSync = vi.hoisted(() => vi.fn());
const mockMkdtempSync = vi.hoisted(() => vi.fn(() => '/tmp/cliff-abc123'));
const mockRmSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
  copyFileSync: mockCopyFileSync,
  mkdtempSync: mockMkdtempSync,
  rmSync: mockRmSync,
}));

vi.mock('../resolveCliffConfigPath.ts', () => ({
  resolveCliffConfigPath: mockResolveCliffConfigPath,
}));

import { buildTagPattern, generateChangelog, generateChangelogs } from '../generateChangelogs.ts';
import type { ReleaseConfig } from '../types.ts';

describe(buildTagPattern, () => {
  it('constructs a tag pattern from a single-package prefix', () => {
    expect(buildTagPattern(['v'])).toBe('v[0-9].*');
  });

  it('constructs a tag pattern from a monorepo workspace prefix', () => {
    expect(buildTagPattern(['release-kit-v'])).toBe('release-kit-v[0-9].*');
  });

  it('builds an alternation group when given multiple prefixes', () => {
    expect(buildTagPattern(['node-monorepo-core-v', 'core-v'])).toBe('(node-monorepo-core-v|core-v)[0-9].*');
  });

  it('escapes regex metacharacters in prefix entries', () => {
    // Contrived legacy prefix with a regex dot — must be escaped so it does not match any char.
    expect(buildTagPattern(['foo.v', 'bar-v'])).toBe(String.raw`(foo\.v|bar-v)[0-9].*`);
  });

  it('throws when given an empty array', () => {
    expect(() => buildTagPattern([])).toThrow('buildTagPattern: tagPrefixes must contain at least one entry');
  });
});

describe(generateChangelog, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockResolveCliffConfigPath.mockReset();
    mockCopyFileSync.mockReset();
    mockMkdtempSync.mockReset().mockReturnValue('/tmp/cliff-abc123');
    mockRmSync.mockReset();
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

  it('appends --tag-pattern flag when tagPattern is provided', () => {
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, 'packages/arrays', 'arrays-v1.0.0', false, {
      tagPattern: 'arrays-v[0-9].*',
      includePaths: ['packages/arrays'],
    });

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
        '--tag-pattern',
        'arrays-v[0-9].*',
        '--include-path',
        'packages/arrays',
      ],
      { stdio: 'inherit' },
    );
  });

  it('does not append --tag-pattern flag when tagPattern is not provided', () => {
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = { cliffConfigPath: 'cliff.toml' };

    generateChangelog(config, 'packages/arrays', 'v1.0.0', false);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      ['--yes', 'git-cliff', '--config', 'cliff.toml', '--output', 'packages/arrays/CHANGELOG.md', '--tag', 'v1.0.0'],
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

  it('copies .template files to a temp .toml before passing to git-cliff', () => {
    mockResolveCliffConfigPath.mockReturnValue('/bundled/cliff.toml.template');
    const config = {};

    const result = generateChangelog(config, 'packages/arrays', 'v1.0.0', false);

    expect(result).toStrictEqual(['packages/arrays/CHANGELOG.md']);
    expect(mockResolveCliffConfigPath).toHaveBeenCalledWith(undefined, expect.any(String));
    expect(mockCopyFileSync).toHaveBeenCalledWith('/bundled/cliff.toml.template', '/tmp/cliff-abc123/cliff.toml');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      [
        '--yes',
        'git-cliff',
        '--config',
        '/tmp/cliff-abc123/cliff.toml',
        '--output',
        'packages/arrays/CHANGELOG.md',
        '--tag',
        'v1.0.0',
      ],
      { stdio: 'inherit' },
    );
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cliff-abc123', { recursive: true, force: true });
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
      changelogJson: { enabled: false, outputPath: '.meta/changelog.json', devOnlySections: [] },
      releaseNotes: { shouldInjectIntoReadme: false },
    } satisfies ReleaseConfig;

    const result = generateChangelogs(config, 'v1.0.0', false);

    expect(result).toStrictEqual(['packages/arrays/CHANGELOG.md', 'packages/strings/CHANGELOG.md']);
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });

  it('passes --tag-pattern derived from tagPrefix', () => {
    mockResolveCliffConfigPath.mockReturnValue('cliff.toml');
    const config = {
      tagPrefix: 'release-kit-v',
      packageFiles: [],
      changelogPaths: ['packages/release-kit'],
      workTypes: {},
      cliffConfigPath: 'cliff.toml',
      changelogJson: { enabled: false, outputPath: '.meta/changelog.json', devOnlySections: [] },
      releaseNotes: { shouldInjectIntoReadme: false },
    } satisfies ReleaseConfig;

    generateChangelogs(config, 'release-kit-v2.3.0', false);

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npx',
      [
        '--yes',
        'git-cliff',
        '--config',
        'cliff.toml',
        '--output',
        'packages/release-kit/CHANGELOG.md',
        '--tag',
        'release-kit-v2.3.0',
        '--tag-pattern',
        'release-kit-v[0-9].*',
      ],
      { stdio: 'inherit' },
    );
  });
});
