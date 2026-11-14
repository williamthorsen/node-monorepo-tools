import { type StreamStyles, UserError } from '@williamthorsen/nmr-core';
import { UsageError } from '@williamthorsen/nmr-core/cli';
import { type CapturedStdio, captureError, captureStdio } from '@williamthorsen/toolbelt.testing/candidate';
import { listConsoleLines, silenceConsole } from '@williamthorsen/toolbelt.vitest/candidate';
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

// Packing from a clean checkout needs an installable repo, which these fixtures are not; the check is covered on its own.
vi.mock(import('../assertTarballsComplete.ts'), () => ({
  assertTarballsComplete: vi.fn(),
}));

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

import { realGit } from '../git.ts';
import { ConfigProblemError } from '../loadValidatedConfig.ts';
import { prepareCommand } from '../prepareCommand.ts';
import { RELEASE_SUMMARY_FILE, RELEASE_TAGS_FILE } from '../releaseFiles.ts';
import { makePrepareOptions } from '../test-utils/commandOptions.ts';
import { makeEmptyWorkspace, makeSinglePackage } from '../test-utils/workspaceResolutions.ts';

const RICH_STYLES: StreamStyles = { stderr: 'rich', stdout: 'rich' };

describe(prepareCommand, () => {
  let stdioCapture: CapturedStdio;

  beforeEach(() => {
    stdioCapture = captureStdio();
    applyPrepareCommandDefaults();
  });

  afterEach(() => {
    stdioCapture[Symbol.dispose]();
    resetPrepareCommandMocks();
    vi.restoreAllMocks();
  });

  it('discovers workspaces and prepares their targets for a monorepo', async () => {
    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: expect.arrayContaining([expect.objectContaining({ tagPrefix: 'arrays-v' })]),
      }),
      { shouldForce: false },
      realGit,
    );
  });

  it('prepares the root target for a single-package repo', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({ targets: [expect.objectContaining({ id: '.', tagPrefix: 'v' })] }),
      {
        shouldForce: false,
      },
      realGit,
    );
  });

  it('passes isDryRun from --dry-run flag', async () => {
    await prepareCommand(makePrepareOptions({ isDryRun: true, styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.any(Object),
      {
        shouldForce: false,
      },
      realGit,
    );
  });

  it('passes bumpOverride from --bump flag', async () => {
    await prepareCommand(makePrepareOptions({ bumpOverride: 'minor', styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.any(Object),
      {
        shouldForce: false,
        bumpOverride: 'minor',
      },
      realGit,
    );
  });

  it('passes force from --force flag', async () => {
    await prepareCommand(makePrepareOptions({ shouldForce: true, bumpOverride: 'patch', styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.any(Object),
      {
        shouldForce: true,
        bumpOverride: 'patch',
      },
      realGit,
    );
  });

  it('passes every workspace and the --only names to the orchestrator', async () => {
    await prepareCommand(makePrepareOptions({ onlyNames: ['arrays'], styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [expect.objectContaining({ id: 'arrays' }), expect.objectContaining({ id: 'strings' })],
      }),
      { shouldForce: false, onlyTargetIds: ['arrays'] },
      realGit,
    );
  });

  // A workspace that doesn't resolve to any package is not single-package mode; reading it as one would prepare the
  // root as one package.
  it("throws a UserError when the workspace doesn't resolve to any package", async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeEmptyWorkspace('all-excluded'));

    const error = await captureError(UserError, () => prepareCommand(makePrepareOptions({ styles: RICH_STYLES })));
    expect(error.message).toContain('No workspace package to release.');
    expect(mockPrepareReleaseTargets).not.toHaveBeenCalled();
  });

  it('throws a UsageError for --only on a single-package repo', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());

    await expect(prepareCommand(makePrepareOptions({ onlyNames: ['foo'], styles: RICH_STYLES }))).rejects.toThrow(
      new UsageError('--only is only supported for monorepo configurations'),
    );
  });

  it('passes a bare --force to a single-package release', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());

    await prepareCommand(makePrepareOptions({ shouldForce: true, styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(expect.any(Object), { shouldForce: true }, realGit);
  });

  it('passes --force --bump=X to a single-package release', async () => {
    mockDiscoverWorkspaces.mockReturnValue(makeSinglePackage());

    await prepareCommand(makePrepareOptions({ shouldForce: true, bumpOverride: 'patch', styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.any(Object),
      {
        shouldForce: true,
        bumpOverride: 'patch',
      },
      realGit,
    );
  });

  it('throws a UsageError for --only with an unknown workspace name in monorepo mode', async () => {
    const error = await captureError(UsageError, () =>
      prepareCommand(makePrepareOptions({ onlyNames: ['arrays', 'nonexistent'], styles: RICH_STYLES })),
    );
    expect(error.message).toContain('Unknown release target "nonexistent"');
    expect(mockPrepareReleaseTargets).not.toHaveBeenCalled();
  });

  it('throws a load problem when loadConfig throws', async () => {
    mockLoadConfig.mockRejectedValue(new Error('parse error'));

    const error = await captureError(ConfigProblemError, () =>
      prepareCommand(makePrepareOptions({ styles: RICH_STYLES })),
    );
    expect(error.problem).toStrictEqual({ kind: 'load', message: 'parse error' });
  });

  it('forwards a relative --config to the loader resolved against the invocation directory', async () => {
    await prepareCommand(
      makePrepareOptions({ configPath: '/invoked/from/elsewhere/alternative.config.ts', styles: RICH_STYLES }),
    );

    expect(mockLoadConfig).toHaveBeenCalledWith('/invoked/from/elsewhere/alternative.config.ts');
  });

  it('forwards an absolute --config to the loader unchanged', async () => {
    await prepareCommand(makePrepareOptions({ configPath: '/elsewhere/alternative.config.ts', styles: RICH_STYLES }));

    expect(mockLoadConfig).toHaveBeenCalledWith('/elsewhere/alternative.config.ts');
  });

  it('reads the default path when --config is absent', async () => {
    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(mockLoadConfig).toHaveBeenCalledWith(undefined);
  });

  it('throws a validation problem when config is invalid', async () => {
    mockLoadConfig.mockResolvedValue({ unknownField: true });

    const error = await captureError(ConfigProblemError, () =>
      prepareCommand(makePrepareOptions({ styles: RICH_STYLES })),
    );
    expect(error.problem.kind).toBe('validation');
    expect(JSON.stringify(error.problem)).toContain('unknownField');
  });

  it('reports config warnings in the style of stderr', async () => {
    mockLoadConfig.mockResolvedValue({
      releaseNotes: { shouldInjectIntoReadme: true },
      changelogJson: { enabled: false },
    });
    using silencedConsole = silenceConsole(['warn']);

    await prepareCommand(makePrepareOptions({ styles: { stderr: 'plain', stdout: 'rich' } }));

    expect(listConsoleLines(silencedConsole.warn)).toContainEqual(
      expect.stringMatching(/^ {2}WARN {2}releaseNotes\.shouldInjectIntoReadme/),
    );
  });

  it.each([
    { style: 'rich', banner: '\n🔍 DRY RUN: release-kit will not modify any files\n' },
    { style: 'plain', banner: '\nDRY RUN: release-kit will not modify any files\n' },
  ] as const)('prints the dry-run banner in the $style style of stdout', async ({ style, banner }) => {
    using silent = silenceConsole(['info']);
    await prepareCommand(makePrepareOptions({ isDryRun: true, styles: { stderr: 'rich', stdout: style } }));

    expect(listConsoleLines(silent.info)).toContain(banner);
  });

  it('writes release tags after applying the plan', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

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

    await prepareCommand(makePrepareOptions({ isDryRun: true, styles: RICH_STYLES }));

    expect(mockWriteFileWithCheck).not.toHaveBeenCalled();
  });

  it('writes the tags file last, after the release files', async () => {
    mockPrepareReleaseTargets.mockReturnValue(
      makePrepareResult({
        tags: ['arrays-v1.0.0'],
        writes: [{ path: 'packages/arrays/package.json', content: '{}\n' }],
      }),
    );

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(listWrittenPaths()).toStrictEqual(['packages/arrays/package.json', RELEASE_TAGS_FILE]);
  });

  it('joins multiple tags with newlines in the release tags file', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0', 'strings-v2.0.1'] }));

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      RELEASE_TAGS_FILE,
      'arrays-v1.0.0\nstrings-v2.0.1',
      expect.any(Object),
    );
  });

  it('rethrows a failed computation as a UserError that ends with the note that the working tree is unchanged', async () => {
    mockPrepareReleaseTargets.mockImplementation(() => {
      throw new UserError("workspace 'arrays' release stage: planVersionBump failed: ENOENT");
    });

    const error = await captureError(UserError, () => prepareCommand(makePrepareOptions({ styles: RICH_STYLES })));

    expect(error.message).toBe(
      "workspace 'arrays' release stage: planVersionBump failed: ENOENT\n" +
        'The command did not write any files; the working tree is unchanged.',
    );
    expect(stdioCapture.stderr).toBe('');
  });

  it('writes the unchanged-tree note and rethrows a crash in computation unchanged', async () => {
    const crash = new TypeError('Cannot read properties of undefined');
    mockPrepareReleaseTargets.mockImplementation(() => {
      throw crash;
    });

    await expect(
      captureError(TypeError, () => prepareCommand(makePrepareOptions({ styles: RICH_STYLES }))),
    ).resolves.toBe(crash);
    expect(stdioCapture.stderrChunks).toStrictEqual([
      'The command did not write any files; the working tree is unchanged.\n',
    ]);
  });

  it('throws, naming the written and unwritten files, when the apply pass fails', async () => {
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

    const error = await captureError(UserError, () => prepareCommand(makePrepareOptions({ styles: RICH_STYLES })));

    expect(error.message).toContain('permission denied');
    expect(error.message).toContain('packages/arrays/package.json');
    expect(error.message).toContain('Not written:');
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

    const error = await captureError(UserError, () => prepareCommand(makePrepareOptions({ styles: RICH_STYLES })));
    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(RELEASE_TAGS_FILE, 'arrays-v1.0.0', expect.any(Object));
    expect(error.message).toContain('the release is prepared');
  });

  it('prints release tags file path when tags are produced', async () => {
    using silent = silenceConsole(['info']);
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(listConsoleLines(silent.info).join('\n')).toContain('Release tags file:');
  });

  it('does not print release tags file path during a dry run', async () => {
    using silent = silenceConsole(['info']);
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['arrays-v1.0.0'] }));

    await prepareCommand(makePrepareOptions({ isDryRun: true, styles: RICH_STYLES }));

    expect(listConsoleLines(silent.info).join('\n')).not.toContain('Release tags file:');
  });

  it('does not print release tags file path when the plan does not produce any tags', async () => {
    using silent = silenceConsole(['info']);
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult());

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(listConsoleLines(silent.info).join('\n')).not.toContain('Release tags file:');
  });

  it('writes the release summary file when the plan contains a summary', async () => {
    mockPrepareReleaseTargets.mockReturnValue(
      makePrepareResult({
        tags: ['release-kit-v2.4.0'],
        summary: 'release-kit-v2.4.0\n- feat: Add commit command',
      }),
    );

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(mockWriteFileWithCheck).toHaveBeenCalledWith(
      RELEASE_SUMMARY_FILE,
      'release-kit-v2.4.0\n- feat: Add commit command',
      { isDryRun: false, shouldOverwrite: true },
    );
  });

  it('does not write the release summary file when the plan does not contain one', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['core-v1.0.0'] }));

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(mockWriteFileWithCheck).not.toHaveBeenCalledWith(
      RELEASE_SUMMARY_FILE,
      expect.any(String),
      expect.any(Object),
    );
  });

  it('prints follow-up message after successful non-dry-run with tags', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['v1.0.0'] }));

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(stdioCapture.stderr).toContain("Run 'release-kit commit'");
  });

  it('does not print follow-up message during dry run', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult({ tags: ['v1.0.0'] }));

    await prepareCommand(makePrepareOptions({ isDryRun: true, styles: RICH_STYLES }));

    expect(stdioCapture.stderr).not.toContain("Run 'release-kit commit'");
  });

  it('applies workspace exclusion from config', async () => {
    mockLoadConfig.mockResolvedValue({
      workspaces: [{ dir: 'strings', shouldExclude: true }],
    });

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(mockPrepareReleaseTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [expect.objectContaining({ tagPrefix: 'arrays-v' })],
      }),
      expect.any(Object),
      realGit,
    );
  });

  it('writes the result of reportPrepare to stdout', async () => {
    mockPrepareReleaseTargets.mockReturnValue(makePrepareResult());

    await prepareCommand(makePrepareOptions({ styles: RICH_STYLES }));

    expect(stdioCapture.stdout).not.toBe('');
  });

  it('throws a UserError when the working tree is dirty', async () => {
    mockAssertCleanWorkingTree.mockImplementation(() => {
      throw new UserError('Working tree has uncommitted changes.');
    });

    const error = await captureError(UserError, () => prepareCommand(makePrepareOptions({ styles: RICH_STYLES })));
    expect(error.message).toContain('uncommitted changes');
  });

  it('skips the clean-tree check when --no-git-checks is provided', async () => {
    await prepareCommand(makePrepareOptions({ shouldSkipGitChecks: true, styles: RICH_STYLES }));

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  it('skips the clean-tree check when -n is provided', async () => {
    await prepareCommand(makePrepareOptions({ shouldSkipGitChecks: true, styles: RICH_STYLES }));

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });

  it('skips the clean-tree check during dry run', async () => {
    await prepareCommand(makePrepareOptions({ isDryRun: true, styles: RICH_STYLES }));

    expect(mockAssertCleanWorkingTree).not.toHaveBeenCalled();
  });
});

// region | Helpers
/** Returns the paths passed to `writeFileWithCheck`, in call order. */
function listWrittenPaths(): string[] {
  return mockWriteFileWithCheck.mock.calls.map((call: unknown[]) => String(call[0]));
}
// endregion | Helpers
