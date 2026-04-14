import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangelogEntry, ChangelogJsonConfig, ReleaseConfig } from '../types.ts';

// Mock execFileSync to avoid actually running git-cliff.
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

// Mock resolveCliffConfigPath to return a dummy path.
vi.mock('../resolveCliffConfigPath.ts', () => ({
  resolveCliffConfigPath: () => '/fake/cliff.toml',
}));

const { execFileSync } = await import('node:child_process');
const { generateChangelogJson, generateSyntheticChangelogJson } = await import('../generateChangelogJson.ts');

const mockedExecFileSync = vi.mocked(execFileSync);

const defaultChangelogJsonConfig: ChangelogJsonConfig = {
  enabled: true,
  outputPath: '.meta/changelog.json',
  devOnlySections: ['CI', 'Dependencies', 'Formatting', 'Internal', 'Tests', 'Tooling'],
};

function makeConfig(
  overrides?: Partial<ChangelogJsonConfig>,
): Pick<ReleaseConfig, 'cliffConfigPath' | 'changelogJson'> {
  return {
    changelogJson: { ...defaultChangelogJsonConfig, ...overrides },
  };
}

describe(generateChangelogJson, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-changelog-json-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns output path without writing in dry-run mode', () => {
    const result = generateChangelogJson(makeConfig(), tempDir, 'v1.0.0', true);
    expect(result).toStrictEqual([`${tempDir}/.meta/changelog.json`]);
  });

  it('transforms git-cliff context into ChangelogEntry array', () => {
    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1700000000,
        commits: [
          { message: '#1 feat: Add new feature', group: 'Features' },
          { message: '#2 fix: Fix a bug', group: 'Bug fixes' },
          { message: '#3 ci: Update pipeline', group: 'CI' },
        ],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    generateChangelogJson(makeConfig(), tempDir, 'v1.0.0', false);

    const outputPath = join(tempDir, '.meta', 'changelog.json');
    const content = readFileSync(outputPath, 'utf8');
    const entries: ChangelogEntry[] = JSON.parse(content);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
    expect(entries[0]?.sections).toHaveLength(3);

    const features = entries[0]?.sections.find((s) => s.title === 'Features');
    expect(features?.audience).toBe('all');
    expect(features?.items[0]?.description).toBe('Add new feature');

    const ci = entries[0]?.sections.find((s) => s.title === 'CI');
    expect(ci?.audience).toBe('dev');
  });

  it('omits releases without version', () => {
    const cliffContext = [
      { commits: [{ message: '#1 feat: Unreleased', group: 'Features' }] },
      {
        version: 'v1.0.0',
        timestamp: 1700000000,
        commits: [{ message: '#2 feat: Released', group: 'Features' }],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    generateChangelogJson(makeConfig(), tempDir, 'v1.0.0', false);

    const outputPath = join(tempDir, '.meta', 'changelog.json');
    const entries: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
  });

  it('tags sections with correct audience based on devOnlySections', () => {
    const cliffContext = [
      {
        version: 'v2.0.0',
        timestamp: 1700000000,
        commits: [
          { message: '#1 feat: Feature', group: 'Features' },
          { message: '#2 deps: Bump deps', group: 'Dependencies' },
          { message: '#3 tests: Add test', group: 'Tests' },
          { message: '#4 fix: Bug fix', group: 'Bug fixes' },
        ],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    generateChangelogJson(makeConfig(), tempDir, 'v2.0.0', false);

    const entries: ChangelogEntry[] = JSON.parse(readFileSync(join(tempDir, '.meta', 'changelog.json'), 'utf8'));

    const audiences = Object.fromEntries(entries[0]?.sections.map((s) => [s.title, s.audience]) ?? []);
    expect(audiences).toStrictEqual({
      Features: 'all',
      Dependencies: 'dev',
      Tests: 'dev',
      'Bug fixes': 'all',
    });
  });

  it('preserves full first line when commit message has no colon separator', () => {
    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1700000000,
        commits: [{ message: 'Initial commit', group: 'Other' }],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    generateChangelogJson(makeConfig(), tempDir, 'v1.0.0', false);

    const outputPath = join(tempDir, '.meta', 'changelog.json');
    const entries: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));

    expect(entries[0]?.sections[0]?.items[0]?.description).toBe('Initial commit');
  });

  it('recovers gracefully when existing changelog JSON is malformed', () => {
    const outputPath = join(tempDir, '.meta', 'changelog.json');
    mkdirSync(join(tempDir, '.meta'), { recursive: true });
    writeFileSync(outputPath, '{invalid json', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1700000000,
        commits: [{ message: '#1 feat: New feature', group: 'Features' }],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    generateChangelogJson(makeConfig(), tempDir, 'v1.0.0', false);

    const entries: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.0');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not parse existing'));
  });

  it('merges new entries with existing entries and sorts newest-first', () => {
    const outputPath = join(tempDir, '.meta', 'changelog.json');
    mkdirSync(join(tempDir, '.meta'), { recursive: true });

    const existing: ChangelogEntry[] = [
      {
        version: '0.9.0',
        date: '2024-01-01',
        sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Old feature' }] }],
      },
    ];
    writeFileSync(outputPath, JSON.stringify(existing), 'utf8');

    const cliffContext = [
      {
        version: 'v1.0.0',
        timestamp: 1700000000,
        commits: [{ message: '#1 feat: New feature', group: 'Features' }],
      },
    ];

    mockedExecFileSync.mockReturnValueOnce(JSON.stringify(cliffContext));

    generateChangelogJson(makeConfig(), tempDir, 'v1.0.0', false);

    const entries: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));
    expect(entries).toHaveLength(2);
    expect(entries[0]?.version).toBe('1.0.0');
    expect(entries[1]?.version).toBe('0.9.0');
  });
});

describe(generateSyntheticChangelogJson, () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-synthetic-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns output path without writing in dry-run mode', () => {
    const config = makeConfig();
    const result = generateSyntheticChangelogJson(config, tempDir, '1.0.1', '2024-01-15', [], true);
    expect(result).toStrictEqual([`${tempDir}/.meta/changelog.json`]);
  });

  it('produces a ChangelogEntry with Dependency updates section', () => {
    const config = makeConfig();
    generateSyntheticChangelogJson(
      config,
      tempDir,
      '1.0.1',
      '2024-01-15',
      [{ packageName: '@scope/dep', newVersion: '2.0.0' }],
      false,
    );

    const outputPath = join(tempDir, '.meta', 'changelog.json');
    const entries: ChangelogEntry[] = JSON.parse(readFileSync(outputPath, 'utf8'));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.0.1');
    expect(entries[0]?.date).toBe('2024-01-15');
    expect(entries[0]?.sections).toHaveLength(1);
    expect(entries[0]?.sections[0]?.title).toBe('Dependency updates');
    expect(entries[0]?.sections[0]?.audience).toBe('dev');
    expect(entries[0]?.sections[0]?.items[0]?.description).toBe('Bumped `@scope/dep` to 2.0.0');
  });
});
