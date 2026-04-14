import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockExtractVersion = vi.hoisted(() => vi.fn());
const mockReadChangelogEntries = vi.hoisted(() => vi.fn());
const mockMatchesAudience = vi.hoisted(() => vi.fn());
const mockRenderReleaseNotesSingle = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

vi.mock('../changelogJsonUtils.ts', () => ({
  extractVersion: mockExtractVersion,
  readChangelogEntries: mockReadChangelogEntries,
}));

vi.mock('../renderReleaseNotes.ts', () => ({
  matchesAudience: mockMatchesAudience,
  renderReleaseNotesSingle: mockRenderReleaseNotesSingle,
}));

import { publish } from '../publish.ts';
import type { ResolvedTag } from '../resolveReleaseTags.ts';

describe(publish, () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Default: no README exists (non-injection tests)
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    mockExecFileSync.mockReset();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockExtractVersion.mockReset();
    mockReadChangelogEntries.mockReset();
    mockMatchesAudience.mockReset();
    mockRenderReleaseNotesSingle.mockReset();
    vi.restoreAllMocks();
  });

  const singleTag: ResolvedTag[] = [{ tag: 'v1.0.0', dir: '.', workspacePath: '.' }];
  const multiTags: ResolvedTag[] = [
    { tag: 'core-v1.3.0', dir: 'core', workspacePath: 'packages/core' },
    { tag: 'release-kit-v2.1.0', dir: 'release-kit', workspacePath: 'packages/release-kit' },
  ];

  it('does nothing when resolvedTags is empty', () => {
    publish([], 'npm', { dryRun: false, noGitChecks: false, provenance: false });

    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it('runs npm publish from the correct directory', () => {
    publish(singleTag, 'npm', { dryRun: false, noGitChecks: false, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('runs pnpm publish from the correct directory for each package', () => {
    publish(multiTags, 'pnpm', { dryRun: false, noGitChecks: false, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish'], {
      cwd: 'packages/core',
      stdio: 'inherit',
    });
    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish'], {
      cwd: 'packages/release-kit',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run flag', () => {
    publish(singleTag, 'npm', { dryRun: true, noGitChecks: false, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish', '--dry-run'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --no-git-checks only for pnpm', () => {
    publish(singleTag, 'pnpm', { dryRun: false, noGitChecks: true, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--no-git-checks'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not forward --no-git-checks for npm', () => {
    publish(singleTag, 'npm', { dryRun: false, noGitChecks: true, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not forward --no-git-checks for yarn', () => {
    publish(singleTag, 'yarn', { dryRun: false, noGitChecks: true, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('runs yarn npm publish for yarn-berry', () => {
    publish(singleTag, 'yarn-berry', { dryRun: false, noGitChecks: false, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run for yarn-berry', () => {
    publish(singleTag, 'yarn-berry', { dryRun: true, noGitChecks: false, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish', '--dry-run'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not forward --no-git-checks for yarn-berry', () => {
    publish(singleTag, 'yarn-berry', { dryRun: false, noGitChecks: true, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards both --dry-run and --no-git-checks for pnpm', () => {
    publish(singleTag, 'pnpm', { dryRun: true, noGitChecks: true, provenance: false });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--dry-run', '--no-git-checks'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --provenance for npm', () => {
    publish(singleTag, 'npm', { dryRun: false, noGitChecks: false, provenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('npm', ['publish', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --provenance for pnpm', () => {
    publish(singleTag, 'pnpm', { dryRun: false, noGitChecks: false, provenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --provenance for yarn-berry', () => {
    publish(singleTag, 'yarn-berry', { dryRun: false, noGitChecks: false, provenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['npm', 'publish', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('does not forward --provenance for classic yarn', () => {
    publish(singleTag, 'yarn', { dryRun: false, noGitChecks: false, provenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['publish'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run and --provenance together for pnpm', () => {
    publish(singleTag, 'pnpm', { dryRun: true, noGitChecks: false, provenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--dry-run', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards all three flags in deterministic order for pnpm', () => {
    publish(singleTag, 'pnpm', { dryRun: true, noGitChecks: true, provenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('pnpm', ['publish', '--dry-run', '--no-git-checks', '--provenance'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('forwards --dry-run but suppresses --provenance for classic yarn', () => {
    publish(singleTag, 'yarn', { dryRun: true, noGitChecks: false, provenance: true });

    expect(mockExecFileSync).toHaveBeenCalledWith('yarn', ['publish', '--dry-run'], {
      cwd: '.',
      stdio: 'inherit',
    });
  });

  it('prints confirmation listing before publishing', () => {
    publish(multiTags, 'pnpm', { dryRun: false, noGitChecks: false, provenance: false });

    expect(console.info).toHaveBeenCalledWith('Publishing:');
    expect(console.info).toHaveBeenCalledWith('  core-v1.3.0 (packages/core)');
    expect(console.info).toHaveBeenCalledWith('  release-kit-v2.1.0 (packages/release-kit)');
  });

  it('prints dry-run confirmation listing', () => {
    publish(multiTags, 'pnpm', { dryRun: true, noGitChecks: false, provenance: false });

    expect(console.info).toHaveBeenCalledWith('[dry-run] Would publish:');
  });

  it('reports successfully published packages when a subsequent publish fails', () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[], opts: { cwd: string }) => {
      if (opts.cwd === 'packages/release-kit') {
        throw new Error('publish failed');
      }
    });

    expect(() => publish(multiTags, 'pnpm', { dryRun: false, noGitChecks: false, provenance: false })).toThrow(
      'publish failed',
    );

    expect(console.warn).toHaveBeenCalledWith('Packages published before failure:');
    expect(console.warn).toHaveBeenCalledWith('  core-v1.3.0');
  });

  describe('README injection', () => {
    const tag: ResolvedTag[] = [{ tag: 'v1.0.0', dir: '.', workspacePath: '/pkg' }];
    const injectionOptions = {
      dryRun: false,
      noGitChecks: false,
      provenance: false,
      releaseNotes: { shouldInjectIntoReadme: true, shouldCreateGithubRelease: false },
      changelogJsonOutputPath: '.meta/changelog.json',
    };

    function setupInjectionMocks(): void {
      // README.md exists, changelog.json exists
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && (p.endsWith('README.md') || p.endsWith('changelog.json'))) {
          return true;
        }
        return false;
      });
      mockReadFileSync.mockReturnValue('# Original README\n');
      mockExtractVersion.mockReturnValue('1.0.0');
      mockReadChangelogEntries.mockReturnValue([
        {
          version: '1.0.0',
          date: '2024-01-01',
          sections: [{ title: 'Features', audience: 'all', items: [{ description: 'Add widget' }] }],
        },
      ]);
      mockMatchesAudience.mockReturnValue(() => true);
      mockRenderReleaseNotesSingle.mockReturnValue('### Features\n\n- Add widget\n');
    }

    it('injects release notes into README before publish when enabled', () => {
      setupInjectionMocks();

      publish(tag, 'npm', injectionOptions);

      // writeFileSync called twice: once for injection, once for restoration
      expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
      // First call: injected content
      const injectedContent = mockWriteFileSync.mock.calls[0]?.[1];
      expect(typeof injectedContent === 'string' && injectedContent).toContain('Features');
    });

    it('restores original README after successful publish', () => {
      setupInjectionMocks();

      publish(tag, 'npm', injectionOptions);

      // Second writeFileSync call restores original
      const restoredContent = mockWriteFileSync.mock.calls[1]?.[1];
      expect(restoredContent).toBe('# Original README\n');
    });

    it('restores original README when publish throws', () => {
      setupInjectionMocks();
      mockExecFileSync.mockImplementation(() => {
        throw new Error('publish failed');
      });

      expect(() => publish(tag, 'npm', injectionOptions)).toThrow('publish failed');

      // Restoration still happens via finally block
      const lastCall = mockWriteFileSync.mock.calls.at(-1);
      expect(lastCall?.[1]).toBe('# Original README\n');
    });

    it('skips injection when changelog.json is missing', () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.endsWith('README.md')) return true;
        return false;
      });
      mockReadFileSync.mockReturnValue('# README\n');

      publish(tag, 'npm', injectionOptions);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found; skipping README injection'));
      // Only the publish happens, no README write
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('warns and skips injection when changelog.json is malformed', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# README\n');
      mockExtractVersion.mockReturnValue('1.0.0');
      mockReadChangelogEntries.mockReturnValue(undefined);

      publish(tag, 'npm', injectionOptions);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('could not parse'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('skipping README injection'));
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('warns and skips injection when all sections are dev-only', () => {
      setupInjectionMocks();
      mockRenderReleaseNotesSingle.mockReturnValue('');

      publish(tag, 'npm', injectionOptions);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no user-facing release notes'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('skipping README injection'));
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('skips injection when no entry matches the tag version', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('# README\n');
      mockExtractVersion.mockReturnValue('99.0.0');
      mockReadChangelogEntries.mockReturnValue([{ version: '1.0.0', date: '2024-01-01', sections: [] }]);

      publish(tag, 'npm', injectionOptions);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no changelog entry for version 99.0.0'));
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
