import { afterEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockHasPrettierConfig = vi.hoisted(() => vi.fn());

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

import { DEFAULT_CHANGELOG_JSON_CONFIG, DEFAULT_RELEASE_NOTES_CONFIG } from '../defaults.ts';
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
    changelogJson: { ...DEFAULT_CHANGELOG_JSON_CONFIG, enabled: false },
    releaseNotes: { ...DEFAULT_RELEASE_NOTES_CONFIG },
    ...overrides,
  };
}

/** Count how many npx git-cliff calls occurred. */
function countCliffCalls(): number {
  return mockExecFileSync.mock.calls.filter(
    (call: unknown[]) => call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff'),
  ).length;
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

/** Collect the --output path from every npx git-cliff call. */
function findAllCliffOutputPaths(): string[] {
  const paths: string[] = [];
  for (const call of mockExecFileSync.mock.calls) {
    if (call[0] === 'npx' && Array.isArray(call[1]) && call[1].includes('git-cliff')) {
      const args = call[1];
      const outputIndex = args.indexOf('--output');
      const outputPath = outputIndex === -1 ? undefined : args[outputIndex + 1];
      if (typeof outputPath === 'string') {
        paths.push(outputPath);
      }
    }
  }
  return paths;
}

describe(releasePrepareMono, () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExecSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockHasPrettierConfig.mockReset();
  });

  it('processes a component that has commits', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      name: 'arrays',
      status: 'released',
      tag: 'arrays-v1.1.0',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      changelogFiles: ['packages/arrays/CHANGELOG.md'],
    });

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
          workspacePath: 'packages/arrays',
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.tags).toStrictEqual([]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      name: 'arrays',
      status: 'skipped',
      commitCount: 0,
    });
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
  });

  it('processes only components with commits when multiple are configured', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
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

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(result.components).toHaveLength(2);
    expect(result.components[0]).toMatchObject({ name: 'arrays', status: 'released' });
    expect(result.components[1]).toMatchObject({ name: 'strings', status: 'skipped' });

    // Only arrays package.json should be written
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith('packages/arrays/package.json', expect.any(String), 'utf8');

    // Only arrays changelog should be generated
    expect(countCliffCalls()).toBe(1);
    const cliffArgs = findCliffCallArgs();
    expect(cliffArgs).toContain('packages/arrays/CHANGELOG.md');
  });

  it('does not write files or run formatCommand when dryRun is true', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    expect(result.dryRun).toBe(true);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
    expect(mockExecSync).not.toHaveBeenCalled();

    // Verify the format command is captured but not executed
    expect(result.formatCommand).toMatchObject({
      command: 'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
      executed: false,
    });
  });

  it('runs formatCommand once after all components are processed', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
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
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md packages/strings/package.json packages/strings/CHANGELOG.md',
      { stdio: 'inherit' },
    );
  });

  it('uses bumpOverride instead of commit-derived bump type', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);

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

  it('applies patch floor when commits exist but none are release-worthy', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(result.components[0]).toMatchObject({
      status: 'released',
      commitCount: 1,
      parsedCommitCount: 0,
      releaseType: 'patch',
    });
    expect(result.components[0]?.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'abc123' }]);
  });

  it('uses parsed bump type when mix of parseable and unparseable commits exist', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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
        return 'feat: add utility\u001Fabc123\nchore: update deps\u001Fdef456';
      }
      return '';
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.components[0]).toMatchObject({
      status: 'released',
      releaseType: 'minor',
      parsedCommitCount: 1,
    });
    expect(result.components[0]?.unparseableCommits).toStrictEqual([{ message: 'chore: update deps', hash: 'def456' }]);
  });

  it('bypasses the no-commits check when force is true', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false, force: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'packages/arrays/package.json',
      expect.stringContaining('"version": "1.0.1"'),
      'utf8',
    );
    expect(countCliffCalls()).toBe(1);
  });

  it('force-bumps a component with no commits while also bumping one with commits', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
        {
          dir: 'strings',
          tagPrefix: 'strings-v',
          workspacePath: 'packages/strings',
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
        if (matchArg?.includes('strings-v')) return 'strings-v2.0.0\n';
      }
      if (cmd === 'git' && args[0] === 'log') {
        const hasStringsPath = args.includes('packages/strings/**');
        if (hasStringsPath) {
          return 'feat: add string helper\u001Fabc123';
        }
        return '';
      }
      return '';
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('arrays')) return JSON.stringify({ version: '1.0.0' });
      return JSON.stringify({ version: '2.0.0' });
    });

    const result = releasePrepareMono(config, { dryRun: false, force: true, bumpOverride: 'patch' });

    // arrays is bumped via --force (0 commits); strings is bumped via commits; both use bumpOverride: 'patch'
    expect(result.tags).toStrictEqual(['arrays-v1.0.1', 'strings-v2.0.1']);
  });

  it('does not write files when force and dryRun are both true', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: true, force: true, bumpOverride: 'patch' });

    expect(result.tags).toStrictEqual(['arrays-v1.0.1']);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(countCliffCalls()).toBe(0);
  });

  it('does not run formatCommand when no components have commits', () => {
    const config = makeConfig({
      formatCommand: 'npx prettier --write',
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
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
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/arrays', version: '1.0.0' }));

    const result = releasePrepareMono(config, { dryRun: false });

    expect(result.tags).toStrictEqual([]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('defaults to prettier when no formatCommand is set and prettier config exists', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });
    mockHasPrettierConfig.mockReturnValue(true);

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

    releasePrepareMono(config, { dryRun: false });

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockExecSync).toHaveBeenCalledWith(
      'npx prettier --write packages/arrays/package.json packages/arrays/CHANGELOG.md',
      { stdio: 'inherit' },
    );
  });

  it('skips formatting when no formatCommand is set and no prettier config exists', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays'],
          paths: ['packages/arrays/**'],
        },
      ],
    });
    mockHasPrettierConfig.mockReturnValue(false);

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

    releasePrepareMono(config, { dryRun: false });

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('generates a changelog for each entry in changelogPaths', () => {
    const config = makeConfig({
      components: [
        {
          dir: 'arrays',
          tagPrefix: 'arrays-v',
          workspacePath: 'packages/arrays',
          packageFiles: ['packages/arrays/package.json'],
          changelogPaths: ['packages/arrays', 'packages/arrays/docs'],
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

    expect(result.tags).toStrictEqual(['arrays-v1.1.0']);
    expect(result.components[0]?.changelogFiles).toStrictEqual([
      'packages/arrays/CHANGELOG.md',
      'packages/arrays/docs/CHANGELOG.md',
    ]);
    expect(countCliffCalls()).toBe(2);
    expect(findAllCliffOutputPaths()).toStrictEqual([
      'packages/arrays/CHANGELOG.md',
      'packages/arrays/docs/CHANGELOG.md',
    ]);
  });

  describe('dependency propagation', () => {
    it('propagates a patch bump to a dependent when a dependency is bumped', () => {
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v2.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'feat: add utility\u001Fabc123';
          return '';
        }
        return '';
      });

      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('core')) {
          return JSON.stringify({
            name: '@test/core',
            version: '1.0.0',
          });
        }
        if (filePath.includes('app')) {
          return JSON.stringify({
            name: '@test/app',
            version: '2.0.0',
            dependencies: { '@test/core': 'workspace:*' },
          });
        }
        return '{}';
      });
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { dryRun: false });

      // core is bumped directly (minor), app is propagated (patch).
      expect(result.tags).toContain('core-v1.1.0');
      expect(result.tags).toContain('app-v2.0.1');
      expect(result.components).toHaveLength(2);

      const coreResult = result.components.find((c) => c.name === 'core');
      expect(coreResult).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        newVersion: '1.1.0',
      });

      const appResult = result.components.find((c) => c.name === 'app');
      expect(appResult).toMatchObject({
        status: 'released',
        releaseType: 'patch',
        newVersion: '2.0.1',
        commitCount: 0,
        propagatedFrom: [{ packageName: '@test/core', newVersion: '1.1.0' }],
      });
    });

    it('writes a synthetic changelog for propagated-only components', () => {
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v1.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'fix: bug fix\u001Fabc123';
          return '';
        }
        return '';
      });

      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('core')) {
          return JSON.stringify({ name: '@test/core', version: '1.0.0' });
        }
        if (filePath.includes('app')) {
          return JSON.stringify({
            name: '@test/app',
            version: '1.0.0',
            dependencies: { '@test/core': 'workspace:*' },
          });
        }
        return '{}';
      });
      mockExistsSync.mockReturnValue(false);

      releasePrepareMono(config, { dryRun: false });

      // git-cliff should be called only for core (direct), not for app (propagated).
      expect(countCliffCalls()).toBe(1);
      const cliffArgs = findCliffCallArgs();
      expect(cliffArgs).toContain('packages/core/CHANGELOG.md');

      // Synthetic changelog written for app.
      const writeCallArgs = mockWriteFileSync.mock.calls;
      const syntheticWrite = writeCallArgs.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0] === 'packages/app/CHANGELOG.md',
      );
      expect(syntheticWrite).toBeDefined();
      expect(syntheticWrite?.[1]).toContain('Dependency updates');
      expect(syntheticWrite?.[1]).toContain('@test/core');
    });

    it('does not propagate to components excluded from config.components', () => {
      // Only include "core" in config — "app" that depends on core is not listed.
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v1.0.0\n';
        if (cmd === 'git' && args[0] === 'log') return 'feat: new feature\u001Fabc123';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '1.0.0' }));

      const result = releasePrepareMono(config, { dryRun: false });

      // Only core should be released since app is not in config.components.
      expect(result.tags).toStrictEqual(['core-v1.1.0']);
      expect(result.components).toHaveLength(1);
    });

    it('writes the explicit --set-version value in monorepo mode', () => {
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { dryRun: false, setVersion: '1.0.0' });

      const coreResult = result.components.find((c) => c.name === 'core');
      expect(coreResult).toMatchObject({
        status: 'released',
        newVersion: '1.0.0',
        currentVersion: '0.5.0',
        setVersion: '1.0.0',
      });
      expect(coreResult?.releaseType).toBeUndefined();
      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        'packages/core/package.json',
        expect.stringContaining('"version": "1.0.0"'),
        'utf8',
      );
    });

    it('throws when --set-version is not greater than the current version', () => {
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => releasePrepareMono(config, { dryRun: false, setVersion: '0.3.0' })).toThrow(
        '--set-version 0.3.0 is not greater than current version 0.5.0',
      );
    });

    it('throws when --set-version equals the current version', () => {
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));

      expect(() => releasePrepareMono(config, { dryRun: false, setVersion: '0.5.0' })).toThrow(
        '--set-version 0.5.0 is not greater than current version 0.5.0',
      );
    });

    it('does not write files in dry-run mode with --set-version', () => {
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') return 'core-v0.5.0\n';
        if (cmd === 'git' && args[0] === 'log') return '';
        return '';
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@test/core', version: '0.5.0' }));
      mockExistsSync.mockReturnValue(false);

      const result = releasePrepareMono(config, { dryRun: true, setVersion: '1.0.0' });

      expect(result.tags).toStrictEqual(['core-v1.0.0']);
      expect(result.dryRun).toBe(true);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('throws when --set-version is used with more than one component', () => {
      // Explicit guard in `determineDirectBumps` enforces the single-component contract for
      // --set-version even if a caller bypasses the CLI layer that normally narrows via --only.
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            tagPrefix: 'app-v',
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      expect(() => releasePrepareMono(config, { dryRun: false, setVersion: '1.0.0' })).toThrow(
        '--set-version requires exactly one component',
      );
    });

    it('preserves a direct higher bump when propagation would add a patch', () => {
      const config = makeConfig({
        components: [
          {
            dir: 'core',
            tagPrefix: 'core-v',
            workspacePath: 'packages/core',
            packageFiles: ['packages/core/package.json'],
            changelogPaths: ['packages/core'],
            paths: ['packages/core/**'],
          },
          {
            dir: 'app',
            tagPrefix: 'app-v',
            workspacePath: 'packages/app',
            packageFiles: ['packages/app/package.json'],
            changelogPaths: ['packages/app'],
            paths: ['packages/app/**'],
          },
        ],
      });

      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'describe') {
          const matchArg = args.find((a: string) => a.startsWith('--match='));
          if (matchArg?.includes('core-v')) return 'core-v1.0.0\n';
          if (matchArg?.includes('app-v')) return 'app-v2.0.0\n';
        }
        if (cmd === 'git' && args[0] === 'log') {
          // Both have commits.
          const hasCorePath = args.includes('packages/core/**');
          if (hasCorePath) return 'fix: core fix\u001Fabc123';
          return 'feat: app feature\u001Fdef456';
        }
        return '';
      });

      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath.includes('core')) {
          return JSON.stringify({ name: '@test/core', version: '1.0.0' });
        }
        if (filePath.includes('app')) {
          return JSON.stringify({
            name: '@test/app',
            version: '2.0.0',
            dependencies: { '@test/core': 'workspace:*' },
          });
        }
        return '{}';
      });

      const result = releasePrepareMono(config, { dryRun: false });

      // app has its own minor bump from commits; propagation adds metadata but keeps minor.
      const appResult = result.components.find((c) => c.name === 'app');
      expect(appResult).toMatchObject({
        status: 'released',
        releaseType: 'minor',
        propagatedFrom: [{ packageName: '@test/core', newVersion: '1.0.1' }],
      });
    });
  });
});
