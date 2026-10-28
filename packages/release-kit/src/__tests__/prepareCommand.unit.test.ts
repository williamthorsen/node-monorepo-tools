import type { StreamStyles } from '@williamthorsen/nmr-core';
import { type CapturedStdio, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { ProcessExitError, silenceConsole, throwOnProcessExit } from '@williamthorsen/toolbelt.vitest/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPrepareCommandDefaults,
  makePrepareResult,
  mockAssertCleanWorkingTree,
  mockDiscoverWorkspaces,
  mockExecSync,
  mockExistsSync,
  mockLoadConfig,
  mockLookUpNpmPackage,
  mockReadFileSync,
  mockPrepareReleaseTargets,
  mockWriteFileWithCheck,
  resetPrepareCommandMocks,
} = await vi.hoisted(() => import('../test-utils/prepareCommandMocks.ts'));

vi.mock(import('node:child_process'), () => ({
  execSync: mockExecSync,
}));

vi.mock(import('node:fs'), () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock(import('../npmRegistry.ts'), () => ({
  lookUpNpmPackage: mockLookUpNpmPackage,
}));

vi.mock(import('../assertCleanWorkingTree.ts'), () => ({
  assertCleanWorkingTree: mockAssertCleanWorkingTree,
}));

// Partial, so that `describeEmptyWorkspace` stays the real composer: What a caller does with an empty
// resolution is the subject here, and its wording is covered against the composer itself.
vi.mock(import('../discoverWorkspaces.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  discoverWorkspaces: mockDiscoverWorkspaces,
}));

vi.mock(import('../loadConfig.ts'), async (importOriginal) => {
  const actualModule = await importOriginal<typeof import('../loadConfig.ts')>();
  return {
    ...actualModule,
    loadConfig: mockLoadConfig,
  };
});

vi.mock(import('../prepareReleaseTargets.ts'), () => ({
  prepareReleaseTargets: mockPrepareReleaseTargets,
}));

vi.mock(import('@williamthorsen/nmr-core'), async (importOriginal) => {
  const actualModule = await importOriginal();
  return {
    ...actualModule,
    writeFileWithCheck: mockWriteFileWithCheck,
  };
});

import { prepareCommand } from '../prepareCommand.ts';
import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from '../releaseFiles.ts';
import { emptyWorkspace, singlePackage } from '../test-utils/workspaceResolutions.ts';
import type { ReleasedPackageResult, SkippedPackageResult } from '../types.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(prepareCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    applyPrepareCommandDefaults();
    void throwOnProcessExit();
    void silenceConsole(['info']);
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    resetPrepareCommandMocks();
    vi.restoreAllMocks();
  });

  it('discovers workspaces and prepares their targets for a monorepo', async () => {
    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.arrayContaining([expect.objectContaining({ tagPrefix: 'arrays-v' })]),
      }),
      { shouldForce: false },
    );
  });

  it('prepares the root target for a single-package repo', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [expect.objectContaining({ id: '.', tagPrefix: 'v' })] }),
      {
        shouldForce: false,
      },
    );
  });

  it('passes isDryRun from --dry-run flag', async () => {
    await prepareCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(expect.any(Object), {
      shouldForce: false,
    });
  });

  it('passes bumpOverride from --bump flag', async () => {
    await prepareCommand(['--bump=minor'], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(expect.any(Object), {
      shouldForce: false,
      bumpOverride: 'minor',
    });
  });

  it('passes force from --force flag', async () => {
    await prepareCommand(['--force', '--bump=patch'], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(expect.any(Object), {
      shouldForce: true,
      bumpOverride: 'patch',
    });
  });

  it('passes every workspace and the --only names to the orchestrator', async () => {
    await prepareCommand(['--only=arrays'], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [expect.objectContaining({ id: 'arrays' }), expect.objectContaining({ id: 'strings' })],
      }),
      { shouldForce: false, onlyTargetIds: ['arrays'] },
    );
  });

  // A workspace that doesn't resolve to any package is not single-package mode; reading it as one would prepare the
  // root as one package.
  it("exits with error when the workspace doesn't resolve to any package", async () => {
    mockDiscoverWorkspaces.mockReturnValue(emptyWorkspace('all-excluded'));

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('No workspace package to release.');
    expect(mockPrepareReleaseTargets).not.toHaveBeenCalled();
  });

  it('exits with error for --only on a single-package repo', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());

    await expect(prepareCommand(['--only=foo'], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('--only is only supported');
  });

  it('passes a bare --force to a single-package release', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());

    await prepareCommand(['--force'], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(expect.any(Object), { shouldForce: true });
  });

  it('passes --force --bump=X to a single-package release', async () => {
    mockDiscoverWorkspaces.mockReturnValue(singlePackage());

    await prepareCommand(['--force', '--bump=patch'], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(expect.any(Object), {
      shouldForce: true,
      bumpOverride: 'patch',
    });
  });

  it('exits with error for --only with an unknown workspace name in monorepo mode', async () => {
    await expect(prepareCommand(['--only=arrays,nonexistent'], RICH_STYLES, process.cwd())).rejects.toThrow(
      ProcessExitError,
    );
    expect(stdioCapture.stderr).toContain('nonexistent');
    expect(mockPrepareReleaseTargets).not.toHaveBeenCalled();
  });

  it('exits with error when loadConfig throws', async () => {
    mockLoadConfig.mockRejectedValue(new Error('parse error'));

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('Failed to load config');
    expect(stdioCapture.stderr).toContain('parse error');
  });

  it('forwards a relative --config to the loader resolved against the invocation directory', async () => {
    await prepareCommand(['--config', 'elsewhere/alternative.config.ts'], RICH_STYLES, '/invoked/from');

    expect(mockLoadConfig).toHaveBeenCalledWith('/invoked/from/elsewhere/alternative.config.ts');
  });

  it('forwards an absolute --config to the loader unchanged', async () => {
    await prepareCommand(['--config', '/elsewhere/alternative.config.ts'], RICH_STYLES, '/invoked/from');

    expect(mockLoadConfig).toHaveBeenCalledWith('/elsewhere/alternative.config.ts');
  });

  it('reads the default path when --config is absent', async () => {
    await prepareCommand([], RICH_STYLES, '/invoked/from');

    expect(mockLoadConfig).toHaveBeenCalledWith(undefined);
  });

  it('exits with error when config is invalid', async () => {
    mockLoadConfig.mockResolvedValue({ unknownField: true });

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderrChunks).toContain('Invalid config:\n');
    expect(stdioCapture.stderr).toContain('unknownField');
  });

  it('reports config errors in the style of stderr', async () => {
    mockLoadConfig.mockResolvedValue({ unknownField: true });

    await expect(prepareCommand([], { stderr: 'plain', stdout: 'rich' }, process.cwd())).rejects.toThrow(
      ProcessExitError,
    );

    expect(stdioCapture.stderr).toMatch(/^ {2}FAIL {2}.*unknownField/m);
    expect(stdioCapture.stderr).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('reports config warnings in the style of stderr', async () => {
    mockLoadConfig.mockResolvedValue({
      releaseNotes: { shouldInjectIntoReadme: true },
      changelogJson: { enabled: false },
    });
    using silencedConsole = silenceConsole(['warn']);

    await prepareCommand([], { stderr: 'plain', stdout: 'rich' }, process.cwd());

    expect(silencedConsole.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^ {2}WARN {2}releaseNotes\.shouldInjectIntoReadme/),
    );
  });

  it.each([
    { style: 'rich', banner: '\n🔍 DRY RUN: release-kit will not modify any files\n' },
    { style: 'plain', banner: '\nDRY RUN: release-kit will not modify any files\n' },
  ] as const)('prints the dry-run banner in the $style style of stdout', async ({ style, banner }) => {
    await prepareCommand(['--dry-run'], { stderr: 'rich', stdout: style }, process.cwd());

    expect(console.info).toHaveBeenCalledWith(banner);
  });

  it('writes release tags after applying the plan', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(RELEASE_TAGS_FILE, 'arrays-v1.0.0', {
      isDryRun: false,
      shouldOverwrite: true,
    });
  });

  it('writes nothing during a dry run', async () => {
    mockPrepareReleaseTargets.mockReturnValue(
      makePrepareResult({
        tags: ['arrays-v1.0.0'],
        summary: 'arrays-v1.0.0\n- feat: Add a thing',
        writes: [{ path: 'packages/arrays/package.json', content: '{}\n' }],
      }),
    );

    await prepareCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });

  it('writes the tags file last, after the release files', async () => {
    mockPrepareReleaseTargets.mockReturnValue(
      makePrepareResult({
        tags: ['arrays-v1.0.0'],
        writes: [{ path: 'packages/arrays/package.json', content: '{}\n' }],
      }),
    );

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(writtenPaths()).toStrictEqual(['packages/arrays/package.json', RELEASE_TAGS_FILE]);
  });

  it('joins multiple tags with newlines in the release tags file', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0', 'strings-v2.0.1'] }));

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      RELEASE_TAGS_FILE,
      'arrays-v1.0.0\nstrings-v2.0.1',
      expect.any(Object),
    );
  });

  it('prints stage-attributed errors with the canonical Error prefix and without the "Error preparing release:" wrapper', async () => {
    mockPrepareReleaseTargets.mockImplementation(() => {
      throw new Error("workspace 'arrays' release stage: planVersionBump failed: ENOENT");
    });

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderrChunks).toContain(
      "Error: workspace 'arrays' release stage: planVersionBump failed: ENOENT\n",
    );
    expect(stdioCapture.stderr).not.toContain('Error preparing release');
  });

  it('reports that the working tree is unchanged when computation fails', async () => {
    mockPrepareReleaseTargets.mockImplementation(() => {
      throw new Error("workspace 'arrays' release stage: ENOBUFS");
    });

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderrChunks).toContain(
      'The command did not write any files; the working tree is unchanged.\n',
    );
  });

  it('exits and names the written and unwritten files when the apply pass fails', async () => {
    mockPrepareReleaseTargets.mockReturnValue(
      makePrepareResult({
        tags: ['arrays-v1.0.0'],
        writes: [
          { path: 'packages/arrays/package.json', content: '{}\n' },
          { path: 'packages/arrays/CHANGELOG.md', content: '# Changelog\n' },
        ],
      }),
    );
    mockWriteFileWithCheck.mockImplementation((path: string) =>
      path === 'packages/arrays/CHANGELOG.md'
        ? { filePath: path, outcome: 'failed', error: 'permission denied' }
        : { filePath: path, outcome: 'created' },
    );

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('permission denied');
    expect(stdioCapture.stderr).toContain('packages/arrays/package.json');
    expect(stdioCapture.stderr).toContain('Not written:');
  });

  it('leaves the release applied and the tags file written when the format command fails', async () => {
    mockPrepareReleaseTargets.mockReturnValue(
      makePrepareResult({
        tags: ['arrays-v1.0.0'],
        formatCommand: { command: 'npx prettier --write packages/arrays/package.json', files: [] },
      }),
    );
    mockExecSync.mockImplementation(() => {
      throw new Error('prettier exited with code 2');
    });

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(RELEASE_TAGS_FILE, 'arrays-v1.0.0', expect.any(Object));
    expect(stdioCapture.stderr).toContain('the release is prepared');
  });

  it('prints release tags file path when tags are produced', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Release tags file:'));
  });

  it('does not print release tags file path during a dry run', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Release tags file:'));
  });

  it('does not print release tags file path when the plan does not produce any tags', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult());

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('Release tags file:'));
  });

  it('writes the release summary file when the plan contains a summary', async () => {
    mockPrepareReleaseTargets.mockReturnValue(
      makePrepareResult({
        tags: ['release-kit-v2.4.0'],
        summary: 'release-kit-v2.4.0\n- feat: Add commit command',
      }),
    );

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      RELEASE_SUMMARY_FILE,
      'release-kit-v2.4.0\n- feat: Add commit command',
      { isDryRun: false, shouldOverwrite: true },
    );
  });

  it('does not write the release summary file when the plan does not contain one', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['core-v1.0.0'] }));

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(mockWriteFileWithCheck).not.toHaveBeenCalledWith(
      RELEASE_SUMMARY_FILE,
      expect.any(String),
      expect.any(Object),
    );
  });

  it('prints follow-up message after successful non-dry-run with tags', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['v1.0.0'] }));

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(stdioCapture.stderr).toContain("Run 'release-kit commit'");
  });

  it('does not print follow-up message during dry run', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['v1.0.0'] }));

    await prepareCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(stdioCapture.stderr).not.toContain("Run 'release-kit commit'");
  });

  it('applies workspace exclusion from config', async () => {
    mockLoadConfig.mockResolvedValue({
      workspaces: [{ dir: 'strings', shouldExclude: true }],
    });

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.any(Object),
    );
  });

  it('writes the result of reportPrepare to stdout', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult());

    await prepareCommand([], RICH_STYLES, process.cwd());

    expect(stdioCapture.stdout).not.toBe('');
  });

  it('exits with error when the working tree is dirty', async () => {
    mockAssertCleanWorkingTree.mockImplementation(() => {
      throw new Error('Working tree has uncommitted changes.');
    });

    await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
    expect(stdioCapture.stderr).toContain('uncommitted changes');
  });

  it('skips the clean-tree check when --no-git-checks is provided', async () => {
    await prepareCommand(['--no-git-checks'], RICH_STYLES, process.cwd());

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  it('skips the clean-tree check when -n is provided', async () => {
    await prepareCommand(['-n'], RICH_STYLES, process.cwd());

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  it('skips the clean-tree check during dry run', async () => {
    await prepareCommand(['--dry-run'], RICH_STYLES, process.cwd());

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  describe('npm check', () => {
    it('looks up only the workspaces that the plan releases', async () => {
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({
          targets: [makeReleasedResult('arrays'), makeSkippedResult('strings')],
          tags: ['arrays-v1.0.0'],
        }),
      );

      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockLookUpNpmPackage).toHaveBeenCalledTimes(1);
      expect(mockLookUpNpmPackage).toHaveBeenCalledWith('@scope/arrays', undefined);
    });

    it('refuses without writing any file when npm does not list a released package', async () => {
      mockLookUpNpmPackage.mockReturnValue({ status: 'unpublished' });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({
          targets: [makeReleasedResult('arrays')],
          tags: ['arrays-v1.0.0'],
          writes: [{ path: 'packages/arrays/package.json', content: '{}\n' }],
        }),
      );

      await expect(prepareCommand([], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
      expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
      expect(stdioCapture.stderrChunks.join('')).toContain(
        '@scope/arrays: run "npm publish --access public" from packages/arrays',
      );
      expect(stdioCapture.stderrChunks).toContain(
        'The command did not write any files; the working tree is unchanged.\n',
      );
    });

    it('refuses during a dry run as well', async () => {
      mockLookUpNpmPackage.mockReturnValue({
        status: 'unverifiable',
        detail: 'Cannot reach the npm registry (ENOTFOUND)',
      });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({ targets: [makeReleasedResult('arrays')], tags: ['arrays-v1.0.0'] }),
      );

      await expect(prepareCommand(['--dry-run'], RICH_STYLES, process.cwd())).rejects.toThrow(ProcessExitError);
      expect(stdioCapture.stderrChunks.join('')).toContain('@scope/arrays: Cannot reach the npm registry (ENOTFOUND)');
    });

    it('looks up the root package in a single-package release', async () => {
      mockDiscoverWorkspaces.mockReturnValue(singlePackage());
      mockReadFileSync.mockImplementation((filePath: string) => {
        if (filePath === 'package.json') {
          return JSON.stringify({ name: 'single-package' });
        }
        throw new Error(`Unexpected readFileSync call for path: ${filePath}`);
      });
      mockPrepareReleaseTargets.mockReturnValue(
        makePrepareResult({ targets: [makeReleasedResult()], tags: ['v1.0.0'] }),
      );

      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockLookUpNpmPackage).toHaveBeenCalledWith('single-package', undefined);
    });

    it('does not call the registry when the plan does not release anything', async () => {
      mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ targets: [makeSkippedResult('arrays')] }));

      await prepareCommand([], RICH_STYLES, process.cwd());

      expect(mockLookUpNpmPackage).not.toHaveBeenCalled();
    });
  });
});

// region | Helpers
/** Builds a released package result, named by workspace `dir` as in monorepo mode. */
function makeReleasedResult(name?: string): ReleasedPackageResult {
  return {
    targetId: name ?? '.',
    kind: 'package',
    status: 'released',
    ...(name !== undefined && { name }),
    commitCount: 1,
    currentVersion: '0.9.0',
    newVersion: '1.0.0',
    tag: name === undefined ? 'v1.0.0' : `${name}-v1.0.0`,
    bumpedFiles: [],
    changelogFiles: [],
  };
}

/** Builds a skipped package result. */
function makeSkippedResult(name: string): SkippedPackageResult {
  return {
    targetId: name,
    kind: 'package',
    status: 'skipped',
    name,
    commitCount: 0,
    parsedCommitCount: 0,
    skipReason: 'No commits',
  };
}

/** Returns the paths passed to `writeFileWithCheck`, in call order. */
function writtenPaths(): string[] {
  return mockWriteFileWithCheck.mock.calls.map((call: unknown[]) => String(call[0]));
}
// endregion | Helpers
