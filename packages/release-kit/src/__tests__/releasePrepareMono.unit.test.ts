import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
}));

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

import { releasePrepareMono } from '../releasePrepareMono.ts';
import type { MonorepoReleaseConfig, WorkTypeConfig } from '../types.ts';

const workTypes: Record<string, WorkTypeConfig> = {
  feat: { header: 'Features' },
  fix: { header: 'Bug fixes' },
};

function makeConfig(overrides?: Partial<MonorepoReleaseConfig>): MonorepoReleaseConfig {
  return {
    components: [],
    workTypes,
    ...overrides,
  };
}

/** Find the first npx git-cliff call's args from the mock call history. */
function findCliffCallArgs(): readonly unknown[] {
  for (const call of mockExecFileSync.mock.calls) {
    if (call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff')) {
      return call[1];
    }
  }
  throw new Error('No npx git-cliff call found in mock history');
}

/** Count how many npx git-cliff calls occurred. */
function countCliffCalls(): number {
  return mockExecFileSync.mock.calls.filter(
    (call: unknown[]) => call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff'),
  ).length;
}

describe(releasePrepareMono, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('processes a component that has commits', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add utility\u001Fabc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result).toStrictEqual(['arrays-v1.1.0']);

    // Verify bumpAllVersions wrote a new version
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/arrays/package.json',
      expect.stringContaining('"version": "1.1.0"'),
      'utf8',
    );

    // Verify git-cliff was called for the component's changelog path
    const cliffArgs = findCliffCallArgs();
    expect(cliffArgs).toContain('--output');
    expect(cliffArgs).toContain('packages/arrays/CHANGELOG.md');
    expect(cliffArgs).toContain('--include-path');
    expect(cliffArgs).toContain('packages/arrays/**');
  });

  it('skips a component with no commits', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result).toStrictEqual([]);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
  });

  it('processes only components with commits when multiple are configured', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          tagPrefix: 'strings-v',
          packageFiles: ['packages/strings/package.json'],
          changelogPaths: ['packages/strings'],
          paths: ['packages/strings/**'],
        },
      ],
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const matchArg = args.find((a: string) => a.startsWith('--match='));
        if (matchArg?.includes('arrays-v')) {
          return 'arrays-v1.0.0\n';
        }
        if (matchArg?.includes('strings-v')) {
          return 'strings-v2.0.0\n';
        }
      }
      if (cmd === 'git' && args[0] === 'log') {
        const hasArraysPath = args.includes('packages/arrays/**');
        if (hasArraysPath) {
          return 'fix: fix array bug\u001Fdef456';
        }
        return '';
      }
      return '';
    });

    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result).toStrictEqual(['arrays-v1.0.1']);

    // Only arrays package.json should be written
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith('packages/arrays/package.json', expect.any(String), 'utf8');

    // Only arrays changelog should be generated
    expect(countCliffCalls()).toBe(1);
    const cliffArgs = findCliffCallArgs();
    expect(cliffArgs).toContain('packages/arrays/CHANGELOG.md');
  });

  it('does not write files or run formatCommand when dryRun is true', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const config = makeConfig({
      formatCommand: 'pnpm run fmt',
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u001Fabc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: true });

    expect(result).toStrictEqual(['arrays-v1.1.0']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
    expect(mockExecSync).not.toHaveBeenCalled();

    // Verify the dry-run log includes modified file paths
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('pnpm run fmt packages/arrays/package.json packages/arrays/CHANGELOG.md'),
    );
    infoSpy.mockRestore();
  });

  it('runs formatCommand once after all components are processed', () => {
    const config = makeConfig({
      formatCommand: 'pnpm run fmt',
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          tagPrefix: 'strings-v',
          packageFiles: ['packages/strings/package.json'],
          changelogPaths: ['packages/strings'],
          paths: ['packages/strings/**'],
        },
      ],
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        const matchArg = args.find((a: string) => a.startsWith('--match='));
        if (matchArg?.includes('arrays-v')) return 'arrays-v1.0.0\n';
        if (matchArg?.includes('strings-v')) return 'strings-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'feat: add feature\u001Fabc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    releasePrepareMono(config, { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      'pnpm run fmt packages/arrays/package.json packages/arrays/CHANGELOG.md packages/strings/package.json packages/strings/CHANGELOG.md',
      { stdio: 'inherit' },
    );
  });

  it('uses bumpOverride instead of commit-derived bump type', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'fix: small patch\u001Fabc123';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false, bumpOverride: 'minor' });

    expect(result).toStrictEqual(['arrays-v1.1.0']);

    // Should use the override (minor) rather than the commit-derived type (patch)
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/arrays/package.json',
      expect.stringContaining('"version": "1.1.0"'),
      'utf8',
    );

    const cliffArgs = findCliffCallArgs();
    expect(cliffArgs).toContain('--tag');
    expect(cliffArgs).toContain('arrays-v1.1.0');
  });

  it('skips a component when commits exist but none are release-worthy', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    // Return a commit whose type (chore) is not in workTypes (only feat, fix)
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return 'chore: update deps\u001Fabc123';
      }
      return '';
    });

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result).toStrictEqual([]);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
  });

  it('does not run formatCommand when no components have commits', () => {
    const config = makeConfig({
      formatCommand: 'pnpm run fmt',
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return 'arrays-v1.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        return '';
      }
      return '';
    });

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result).toStrictEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});
